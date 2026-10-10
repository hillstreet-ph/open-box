package handles

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"

	"github.com/OpenListTeam/OpenList/v4/pkg/utils/random"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/OpenListTeam/go-cache"
	"github.com/gin-gonic/gin"
)

type githubSSOAttempt struct {
	ClientID, Method, RedirectURI, Verifier, BrowserID string
}

var githubSSOAttempts = cache.NewMemCache[githubSSOAttempt]()
var githubSSOConsumeMu sync.Mutex

func githubSSOCookie(method string) string { return "__Host-openbox-github-sso-" + method }

func beginGithubSSO(c *gin.Context, clientID, method, redirectURI string, values url.Values) error {
	if method != "sso_get_token" && method != "get_sso_id" {
		return errors.New("invalid SSO method")
	}
	callback, err := url.Parse(redirectURI)
	if err != nil || callback.Scheme != "https" || callback.Host == "" || callback.User != nil || clientID == "" {
		return errors.New("GitHub SSO requires a client ID and canonical HTTPS callback")
	}
	state, verifier, browserID := random.String(43), random.String(64), random.String(43)
	githubSSOAttempts.Set(state, githubSSOAttempt{ClientID: clientID, Method: method, RedirectURI: redirectURI, Verifier: verifier, BrowserID: browserID}, cache.WithEx[githubSSOAttempt](stateExpire))
	challenge := sha256.Sum256([]byte(verifier))
	values.Set("state", state)
	values.Set("code_challenge", base64.RawURLEncoding.EncodeToString(challenge[:]))
	values.Set("code_challenge_method", "S256")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(githubSSOCookie(method), browserID, int(stateExpire.Seconds()), "/", "", true, true)
	c.Header("Cache-Control", "no-store")
	return nil
}

func consumeGithubSSO(c *gin.Context, clientID, method, redirectURI string) (string, error) {
	state := c.Query("state")
	browserID, err := c.Cookie(githubSSOCookie(method))
	if err != nil || state == "" || browserID == "" {
		return "", errors.New("missing SSO browser state")
	}
	githubSSOConsumeMu.Lock()
	defer githubSSOConsumeMu.Unlock()
	attempt, ok := githubSSOAttempts.Get(state)
	if !ok || attempt.ClientID != clientID || attempt.Method != method || attempt.RedirectURI != redirectURI || subtle.ConstantTimeCompare([]byte(attempt.BrowserID), []byte(browserID)) != 1 {
		return "", errors.New("incorrect or expired SSO browser state")
	}
	// Atomic removal permits only one token exchange, including concurrent callbacks.
	githubSSOAttempts.Del(state)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(githubSSOCookie(method), "", -1, "/", "", true, true)
	return attempt.Verifier, nil
}

func githubSSOMessage(c *gin.Context, field, value string) {
	api, err := url.Parse(common.GetApiUrl(c))
	if err != nil || api.Scheme != "https" || api.Host == "" || api.User != nil {
		common.ErrorStrResp(c, "invalid SSO response origin", http.StatusBadRequest)
		return
	}
	payload, _ := json.Marshal(map[string]string{field: value})
	origin, _ := json.Marshal(api.Scheme + "://" + api.Host)
	nonce := random.String(32)
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'")
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(fmt.Sprintf(`<!doctype html><html><head><title>Open-Box sign-in</title></head><body><script nonce="%s">if(window.opener){window.opener.postMessage(%s,%s);window.close();}</script></body></html>`, nonce, payload, origin)))
}
