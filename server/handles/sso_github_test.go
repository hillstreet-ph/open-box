package handles

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/OpenListTeam/go-cache"
	"github.com/gin-gonic/gin"
	"github.com/go-resty/resty/v2"
)

const testGithubRedirect = "https://open-box.example/api/auth/sso_callback?method=get_sso_id"

func githubContext(target string, cookie *http.Cookie) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, engine := gin.CreateTestContext(w)
	engine.ContextWithFallback = true
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	if cookie != nil {
		c.Request.AddCookie(cookie)
	}
	common.GinAppendValues(c, conf.ApiUrlKey, "https://open-box.example")
	return c, w
}

func beginTestGithub(t *testing.T) (url.Values, *http.Cookie) {
	t.Helper()
	c, w := githubContext("https://open-box.example/api/auth/sso?method=get_sso_id", nil)
	v := url.Values{}
	if err := beginGithubSSO(c, "test-client", "get_sso_id", testGithubRedirect, v); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { githubSSOAttempts.Del(v.Get("state")) })
	return v, w.Result().Cookies()[0]
}

func TestGithubSSOBindsBrowserAndPKCE(t *testing.T) {
	v, cookie := beginTestGithub(t)
	if !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" || cookie.Domain != "" || !strings.HasPrefix(cookie.Name, "__Host-") {
		t.Fatalf("unsafe cookie attributes: %s", cookie.Name)
	}
	if cookie.MaxAge != 300 || len(v.Get("state")) != 43 || v.Get("code_challenge_method") != "S256" {
		t.Fatal("unexpected state lifetime or PKCE configuration")
	}
	c, w := githubContext("https://open-box.example/callback?state="+v.Get("state"), cookie)
	verifier, err := consumeGithubSSO(c, "test-client", "get_sso_id", testGithubRedirect)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(verifier))
	if v.Get("code_challenge") != base64.RawURLEncoding.EncodeToString(digest[:]) {
		t.Fatal("PKCE verifier does not match challenge")
	}
	if w.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal("callback did not clear browser binding")
	}
	if _, err := consumeGithubSSO(c, "test-client", "get_sso_id", testGithubRedirect); err == nil {
		t.Fatal("replayed callback accepted")
	}
}

func TestGithubSSORejectsForeignExpiredAndAlteredFlows(t *testing.T) {
	for _, kind := range []string{"missing-cookie", "foreign-cookie", "client", "method", "redirect", "expired"} {
		t.Run(kind, func(t *testing.T) {
			v, cookie := beginTestGithub(t)
			copyCookie := *cookie
			client, method, redirect := "test-client", "get_sso_id", testGithubRedirect
			switch kind {
			case "missing-cookie":
				cookie = nil
			case "foreign-cookie":
				copyCookie.Value = "foreign-browser"
				cookie = &copyCookie
			case "client":
				client = "foreign-client"
			case "method":
				method = "sso_get_token"
			case "redirect":
				redirect = "https://foreign.example/callback"
			case "expired":
				a, _ := githubSSOAttempts.Get(v.Get("state"))
				githubSSOAttempts.Set(v.Get("state"), a, cache.WithEx[githubSSOAttempt](-time.Second))
			}
			c, _ := githubContext("https://open-box.example/callback?state="+v.Get("state"), cookie)
			if _, err := consumeGithubSSO(c, client, method, redirect); err == nil {
				t.Fatal("invalid callback accepted")
			}
		})
	}
	for _, redirect := range []string{"http://open-box.example/callback", "https://user:password@open-box.example/callback", "/callback"} {
		c, _ := githubContext("https://open-box.example/", nil)
		if err := beginGithubSSO(c, "test-client", "get_sso_id", redirect, url.Values{}); err == nil {
			t.Fatal("invalid canonical callback accepted")
		}
	}
}

func TestGithubSSOConcurrentCallbacksExchangeOnlyOnce(t *testing.T) {
	v, cookie := beginTestGithub(t)
	var successful atomic.Int32
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, _ := githubContext("https://open-box.example/callback?state="+v.Get("state"), cookie)
			if _, err := consumeGithubSSO(c, "test-client", "get_sso_id", testGithubRedirect); err == nil {
				successful.Add(1)
			}
		}()
	}
	wg.Wait()
	if successful.Load() != 1 {
		t.Fatalf("accepted %d callbacks", successful.Load())
	}
}

func TestGithubSSOResponseRestrictsOriginAndEscapesValues(t *testing.T) {
	c, w := githubContext("https://open-box.example/callback", nil)
	githubSSOMessage(c, "sso_id", `</script><script>alert(1)</script>`)
	body := w.Body.String()
	if !strings.Contains(body, `,"https://open-box.example"`) || strings.Contains(body, `,"*"`) || strings.Contains(body, "</script><script>") {
		t.Fatal("unsafe opener origin or unescaped payload")
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "script-src 'nonce-") {
		t.Fatal("missing response protections")
	}
}

type githubRoundTrip func(*http.Request) (*http.Response, error)

func (fn githubRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return fn(r) }

func TestGithubSSOHandlersValidateStateBeforeProviderAndSendPKCE(t *testing.T) {
	oldCache, oldClient := op.Cache, githubSSOClient
	op.Cache = op.NewCacheManager()
	t.Cleanup(func() { op.Cache = oldCache; githubSSOClient = oldClient })
	for key, value := range map[string]string{conf.SSOLoginEnabled: "true", conf.SSOLoginPlatform: "Github", conf.SSOClientId: "test-client", conf.SSOClientSecret: "test-only-secret", conf.SSOCompatibilityMode: "false"} {
		op.Cache.SetSetting(key, &model.SettingItem{Key: key, Value: value})
	}
	var calls int
	var expectedChallenge string
	githubSSOClient = resty.New().SetRetryCount(0).SetTransport(githubRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		body := `{"id":123,"login":"test-user"}`
		if r.URL.Path == "/login/oauth/access_token" {
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if r.Form.Get("code_verifier") == "" || base64.RawURLEncoding.EncodeToString(digest[:]) != expectedChallenge || r.Form.Get("redirect_uri") != testGithubRedirect {
				t.Fatal("token exchange missing bound verifier or callback")
			}
			body = `{"access_token":"test-only-token"}`
		} else if r.URL.Host != "api.github.com" || r.Header.Get("Authorization") != "Bearer test-only-token" {
			t.Fatal("unexpected provider request")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	}))
	missing, denied := githubContext("https://open-box.example/api/auth/sso_callback?method=get_sso_id&code=test-only-code", nil)
	SSOLoginCallback(missing)
	var envelope struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(denied.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if calls != 0 || envelope.Code != 400 {
		t.Fatal("unbound callback reached provider")
	}
	start, started := githubContext("https://open-box.example/api/auth/sso?method=get_sso_id", nil)
	SSOLoginRedirect(start)
	authorization, err := url.Parse(started.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if authorization.Host != "github.com" || authorization.Query().Get("state") == "" {
		t.Fatal("redirect missing protected state")
	}
	expectedChallenge = authorization.Query().Get("code_challenge")
	callback, completed := githubContext("https://open-box.example/api/auth/sso_callback?method=get_sso_id&code=test-only-code&state="+authorization.Query().Get("state"), started.Result().Cookies()[0])
	SSOLoginCallback(callback)
	if calls != 2 || !strings.Contains(completed.Body.String(), `"sso_id":"123"`) {
		t.Fatal("protected callback did not complete identity flow")
	}
}

func TestGithubSSOProviderErrorsNeverReturnIdentity(t *testing.T) {
	for _, kind := range []string{"token-status", "empty-token", "identity-status"} {
		t.Run(kind, func(t *testing.T) {
			oldCache, oldClient := op.Cache, githubSSOClient
			op.Cache = op.NewCacheManager()
			t.Cleanup(func() { op.Cache = oldCache; githubSSOClient = oldClient })
			for key, value := range map[string]string{conf.SSOLoginEnabled: "true", conf.SSOLoginPlatform: "Github", conf.SSOClientId: "test-client", conf.SSOClientSecret: "test-only-secret", conf.SSOCompatibilityMode: "false"} {
				op.Cache.SetSetting(key, &model.SettingItem{Key: key, Value: value})
			}
			calls := 0
			githubSSOClient = resty.New().SetRetryCount(0).SetTransport(githubRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				status, body := 200, `{"access_token":"test-only-token"}`
				if r.URL.Host == "api.github.com" {
					status, body = 500, `{"id":123}`
				} else if kind == "token-status" {
					status = 500
				} else if kind == "empty-token" {
					body = `{}`
				}
				return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
			}))
			v, cookie := beginTestGithub(t)
			c, w := githubContext("https://open-box.example/api/auth/sso_callback?method=get_sso_id&code=test-only-code&state="+v.Get("state"), cookie)
			SSOLoginCallback(c)
			var envelope struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			wantCalls := 1
			if kind == "identity-status" {
				wantCalls = 2
			}
			if envelope.Code != 400 || calls != wantCalls || strings.Contains(w.Body.String(), "test-only-token") {
				t.Fatal("provider error produced identity or retried an exchange")
			}
		})
	}
}
