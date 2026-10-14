package handles

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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
	"github.com/gin-gonic/gin"
	"github.com/go-resty/resty/v2"
)

const testGithubRedirect = "https://open-box.example/api/auth/sso_callback"

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
	resetGithubAdmission(t)
	c, w := githubContext("https://open-box.example/api/auth/sso?method=get_sso_id", nil)
	v := url.Values{}
	if err := beginGithubSSO(c, "test-client", "get_sso_id", testGithubRedirect, v); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		githubSSOAttemptsMu.Lock()
		delete(githubSSOAttempts, v.Get("state"))
		githubSSOAttemptsMu.Unlock()
	})
	return v, w.Result().Cookies()[0]
}

func resetGithubAdmission(t *testing.T) {
	t.Helper()
	githubSSOAttemptsMu.Lock()
	previous := githubSSOAdmission
	githubSSOAdmission = [4096]githubSSOAdmissionBucket{}
	githubSSOAttemptsMu.Unlock()
	t.Cleanup(func() {
		githubSSOAttemptsMu.Lock()
		githubSSOAdmission = previous
		githubSSOAttemptsMu.Unlock()
	})
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
	method, verifier, err := consumeGithubSSO(c, "test-client", testGithubRedirect)
	if err != nil {
		t.Fatal(err)
	}
	if method != "get_sso_id" {
		t.Fatalf("unexpected callback method %q", method)
	}
	digest := sha256.Sum256([]byte(verifier))
	if v.Get("code_challenge") != base64.RawURLEncoding.EncodeToString(digest[:]) {
		t.Fatal("PKCE verifier does not match challenge")
	}
	if w.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal("callback did not clear browser binding")
	}
	if _, _, err := consumeGithubSSO(c, "test-client", testGithubRedirect); err == nil {
		t.Fatal("replayed callback accepted")
	}
}

func TestGithubSSORejectsForeignExpiredAndAlteredFlows(t *testing.T) {
	for _, kind := range []string{"missing-cookie", "foreign-cookie", "client", "method", "redirect", "expired"} {
		t.Run(kind, func(t *testing.T) {
			v, cookie := beginTestGithub(t)
			copyCookie := *cookie
			client, redirect := "test-client", testGithubRedirect
			switch kind {
			case "missing-cookie":
				cookie = nil
			case "foreign-cookie":
				copyCookie.Value = "foreign-browser"
				cookie = &copyCookie
			case "client":
				client = "foreign-client"
			case "method":
				githubSSOAttemptsMu.Lock()
				a := githubSSOAttempts[v.Get("state")]
				a.Method = "invalid-method"
				githubSSOAttempts[v.Get("state")] = a
				githubSSOAttemptsMu.Unlock()
			case "redirect":
				redirect = "https://foreign.example/callback"
			case "expired":
				githubSSOAttemptsMu.Lock()
				a := githubSSOAttempts[v.Get("state")]
				a.ExpiresAt = time.Now().Add(-time.Second)
				githubSSOAttempts[v.Get("state")] = a
				githubSSOAttemptsMu.Unlock()
			}
			c, _ := githubContext("https://open-box.example/callback?state="+v.Get("state"), cookie)
			if _, _, err := consumeGithubSSO(c, client, redirect); err == nil {
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
			if _, _, err := consumeGithubSSO(c, "test-client", testGithubRedirect); err == nil {
				successful.Add(1)
			}
		}()
	}
	wg.Wait()
	if successful.Load() != 1 {
		t.Fatalf("accepted %d callbacks", successful.Load())
	}
}

func TestGithubSSOAttemptStoreIsBounded(t *testing.T) {
	resetGithubAdmission(t)
	githubSSOAttemptsMu.Lock()
	githubSSOAttempts = make(map[string]githubSSOAttempt, githubSSOAttemptLimit)
	for i := range githubSSOAttemptLimit {
		githubSSOAttempts[fmt.Sprintf("state-%d", i)] = githubSSOAttempt{ExpiresAt: time.Now().Add(stateExpire)}
	}
	githubSSOAttemptsMu.Unlock()
	t.Cleanup(func() {
		githubSSOAttemptsMu.Lock()
		githubSSOAttempts = make(map[string]githubSSOAttempt)
		githubSSOAttemptsMu.Unlock()
	})
	c, _ := githubContext("https://open-box.example/api/auth/sso?method=get_sso_id", nil)
	if err := beginGithubSSO(c, "test-client", "get_sso_id", testGithubRedirect, url.Values{}); err == nil {
		t.Fatal("unbounded SSO attempt accepted")
	}
	githubSSOAttemptsMu.Lock()
	githubSSOAttempts["state-0"] = githubSSOAttempt{ExpiresAt: time.Now().Add(-time.Second)}
	githubSSOAttemptsMu.Unlock()
	if err := beginGithubSSO(c, "test-client", "get_sso_id", testGithubRedirect, url.Values{}); err != nil {
		t.Fatalf("expired attempt did not release capacity: %v", err)
	}
}

func TestGithubSSOInitiationFloodCannotFillTheGlobalStore(t *testing.T) {
	resetGithubAdmission(t)
	githubSSOAttemptsMu.Lock()
	previous := githubSSOAttempts
	githubSSOAttempts = make(map[string]githubSSOAttempt)
	githubSSOAttemptsMu.Unlock()
	t.Cleanup(func() {
		githubSSOAttemptsMu.Lock()
		githubSSOAttempts = previous
		githubSSOAttemptsMu.Unlock()
	})
	accepted := 0
	for i := range githubSSOAttemptLimit {
		c, w := githubContext("https://open-box.example/api/auth/sso?method=get_sso_id", nil)
		c.Request.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i%250+1))
		c.Request.Header.Set("X-Real-IP", fmt.Sprintf("203.0.113.%d", i%250+1))
		err := beginGithubSSO(c, "test-client", "get_sso_id", testGithubRedirect, url.Values{})
		if err == nil {
			accepted++
		} else if !errors.Is(err, errGithubSSORateLimited) || w.Header().Get("Retry-After") != "5" || len(w.Result().Cookies()) != 0 {
			t.Fatalf("unexpected flood rejection: %v", err)
		}
	}
	if accepted != githubSSOAdmissionBurst || len(githubSSOAttempts) != githubSSOAdmissionBurst {
		t.Fatalf("flood allocated %d attempts", accepted)
	}
	c, _ := githubContext("https://open-box.example/api/auth/sso?method=get_sso_id", nil)
	c.Request.RemoteAddr = "192.0.2.2:1234"
	if err := beginGithubSSO(c, "test-client", "get_sso_id", testGithubRedirect, url.Values{}); err != nil {
		t.Fatalf("one peer denied an unrelated sign-in: %v", err)
	}
}

func TestGithubSSOAdmissionRefillsWithinFixedMemory(t *testing.T) {
	resetGithubAdmission(t)
	githubSSOAttemptsMu.Lock()
	defer githubSSOAttemptsMu.Unlock()
	now := time.Now()
	for range githubSSOAdmissionBurst {
		if !admitGithubSSO("192.0.2.1", now) {
			t.Fatal("initial burst denied")
		}
	}
	if admitGithubSSO("192.0.2.1", now.Add(githubSSOAdmissionInterval-time.Millisecond)) {
		t.Fatal("admission refilled too early")
	}
	if !admitGithubSSO("192.0.2.1", now.Add(githubSSOAdmissionInterval)) || admitGithubSSO("192.0.2.1", now.Add(githubSSOAdmissionInterval)) {
		t.Fatal("admission did not refill exactly one attempt")
	}
	for i := range 10000 {
		admitGithubSSO(fmt.Sprintf("peer-%d", i), now)
	}
	if len(githubSSOAdmission) != 4096 {
		t.Fatal("admission bookkeeping grew with peer count")
	}
}

func TestGithubSSOInitiationHandlerReportsRateLimit(t *testing.T) {
	resetGithubAdmission(t)
	previous := op.Cache
	op.Cache = op.NewCacheManager()
	states := []string{}
	t.Cleanup(func() {
		op.Cache = previous
		githubSSOAttemptsMu.Lock()
		for _, state := range states {
			delete(githubSSOAttempts, state)
		}
		githubSSOAttemptsMu.Unlock()
	})
	for key, value := range map[string]string{conf.SSOLoginEnabled: "true", conf.SSOLoginPlatform: "Github", conf.SSOClientId: "test-client", conf.SSOCompatibilityMode: "false"} {
		op.Cache.SetSetting(key, &model.SettingItem{Key: key, Value: value})
	}
	for range githubSSOAdmissionBurst {
		c, w := githubContext("https://open-box.example/api/auth/sso?method=sso_get_token", nil)
		SSOLoginRedirect(c)
		redirect, err := url.Parse(w.Header().Get("Location"))
		if err != nil || w.Code != http.StatusFound || redirect.Query().Get("state") == "" {
			t.Fatal("expected initial authorization redirect")
		}
		states = append(states, redirect.Query().Get("state"))
	}
	c, w := githubContext("https://open-box.example/api/auth/sso?method=sso_get_token", nil)
	SSOLoginRedirect(c)
	var envelope struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil || envelope.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") != "5" || w.Header().Get("Location") != "" {
		t.Fatalf("incorrect admission rejection: %s", w.Body.String())
	}
}

func TestGithubSSOSameMethodPopupsRetainIndependentBindings(t *testing.T) {
	for _, method := range []string{"get_sso_id", "sso_get_token"} {
		t.Run(method, func(t *testing.T) {
			resetGithubAdmission(t)
			values := []url.Values{{}, {}}
			cookies := make([]*http.Cookie, 2)
			for i := range values {
				c, w := githubContext("https://open-box.example/api/auth/sso?method="+method, nil)
				if err := beginGithubSSO(c, "test-client", method, testGithubRedirect, values[i]); err != nil {
					t.Fatal(err)
				}
				cookies[i] = w.Result().Cookies()[0]
			}
			if cookies[0].Name == cookies[1].Name {
				t.Fatal("second popup overwrote the first binding")
			}
			// The browser sends both cookies after starting both popups.
			for i, v := range values {
				c, w := githubContext("https://open-box.example/callback?state="+v.Get("state"), cookies[0])
				c.Request.AddCookie(cookies[1])
				if got, _, err := consumeGithubSSO(c, "test-client", testGithubRedirect); err != nil || got != method {
					t.Fatalf("popup %d rejected: %v", i, err)
				}
				if cleared := w.Result().Cookies()[0]; cleared.Name != cookies[i].Name || cleared.MaxAge != -1 {
					t.Fatal("callback cleared another popup's binding")
				}
			}
		})
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
	resetGithubAdmission(t)
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
	missing, denied := githubContext("https://open-box.example/api/auth/sso_callback?code=test-only-code", nil)
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
	if authorization.Query().Get("redirect_uri") != testGithubRedirect {
		t.Fatal("GitHub authorization used a query-bearing callback")
	}
	callback, completed := githubContext("https://open-box.example/api/auth/sso_callback?code=test-only-code&state="+authorization.Query().Get("state"), started.Result().Cookies()[0])
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
			c, w := githubContext("https://open-box.example/api/auth/sso_callback?code=test-only-code&state="+v.Get("state"), cookie)
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
