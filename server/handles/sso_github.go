package handles

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/pkg/utils/random"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

type githubSSOAttempt struct {
	ClientID, Method, RedirectURI, Verifier, BrowserID string
	ExpiresAt                                          time.Time
}

const githubSSOAttemptLimit = 1024

// Fixed buckets bound admission bookkeeping even for forged forwarding headers
// or many source addresses. Each transport peer gets eight immediate attempts
// and one more every five seconds: at most 68 pending attempts in five minutes.
const githubSSOAdmissionBurst = 8
const githubSSOAdmissionInterval = 5 * time.Second

type githubSSOAdmissionBucket struct {
	Credit  time.Duration
	Updated time.Time
}

var githubSSOAdmission [4096]githubSSOAdmissionBucket
var errGithubSSORateLimited = errors.New("too many GitHub SSO attempts; try again shortly")

var githubSSOAttempts = make(map[string]githubSSOAttempt)
var githubSSOAttemptsMu sync.Mutex

func githubSSOCookie(state string) string { return "__Host-openbox-github-sso-" + state }

// Caller holds githubSSOAttemptsMu. Do not trust Gin's default forwarded IP
// handling here: arbitrary X-Forwarded-For headers must not bypass admission.
func admitGithubSSO(peer string, now time.Time) bool {
	digest := sha256.Sum256([]byte(peer))
	bucket := &githubSSOAdmission[int(binary.BigEndian.Uint16(digest[:2]))%len(githubSSOAdmission)]
	if bucket.Updated.IsZero() {
		bucket.Credit = githubSSOAdmissionBurst * githubSSOAdmissionInterval
	} else {
		capacity := githubSSOAdmissionBurst * githubSSOAdmissionInterval
		elapsed := max(time.Duration(0), min(capacity, now.Sub(bucket.Updated)))
		bucket.Credit = min(capacity, bucket.Credit+elapsed)
	}
	bucket.Updated = now
	if bucket.Credit < githubSSOAdmissionInterval {
		return false
	}
	bucket.Credit -= githubSSOAdmissionInterval
	return true
}

func githubSSORedirectURI(c *gin.Context) string {
	return common.GetApiUrl(c) + "/api/auth/sso_callback"
}

func purgeExpiredGithubSSOAttempts(now time.Time) {
	for state, attempt := range githubSSOAttempts {
		if !attempt.ExpiresAt.After(now) {
			delete(githubSSOAttempts, state)
		}
	}
}

func beginGithubSSO(c *gin.Context, clientID, method, redirectURI string, values url.Values) error {
	if method != "sso_get_token" && method != "get_sso_id" {
		return errors.New("invalid SSO method")
	}
	callback, err := url.Parse(redirectURI)
	if err != nil || callback.Scheme != "https" || callback.Host == "" || callback.User != nil || clientID == "" {
		return errors.New("GitHub SSO requires a client ID and canonical HTTPS callback")
	}
	peer := c.RemoteIP()
	if peer == "" {
		return errors.New("missing GitHub SSO transport peer")
	}
	githubSSOAttemptsMu.Lock()
	now := time.Now()
	if !admitGithubSSO(peer, now) {
		githubSSOAttemptsMu.Unlock()
		c.Header("Retry-After", "5")
		return errGithubSSORateLimited
	}
	purgeExpiredGithubSSOAttempts(now)
	if len(githubSSOAttempts) >= githubSSOAttemptLimit {
		githubSSOAttemptsMu.Unlock()
		return errors.New("too many pending GitHub SSO attempts")
	}
	state, verifier, browserID := random.String(43), random.String(64), random.String(43)
	githubSSOAttempts[state] = githubSSOAttempt{ClientID: clientID, Method: method, RedirectURI: redirectURI, Verifier: verifier, BrowserID: browserID, ExpiresAt: now.Add(stateExpire)}
	githubSSOAttemptsMu.Unlock()
	challenge := sha256.Sum256([]byte(verifier))
	values.Set("state", state)
	values.Set("code_challenge", base64.RawURLEncoding.EncodeToString(challenge[:]))
	values.Set("code_challenge_method", "S256")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(githubSSOCookie(state), browserID, int(stateExpire.Seconds()), "/", "", true, true)
	c.Header("Cache-Control", "no-store")
	return nil
}

func consumeGithubSSO(c *gin.Context, clientID, redirectURI string) (string, string, error) {
	state := c.Query("state")
	if len(state) != 43 {
		return "", "", errors.New("missing SSO browser state")
	}
	githubSSOAttemptsMu.Lock()
	defer githubSSOAttemptsMu.Unlock()
	purgeExpiredGithubSSOAttempts(time.Now())
	attempt, ok := githubSSOAttempts[state]
	if !ok || attempt.ClientID != clientID || attempt.RedirectURI != redirectURI || (attempt.Method != "sso_get_token" && attempt.Method != "get_sso_id") {
		return "", "", errors.New("incorrect or expired SSO browser state")
	}
	browserID, err := c.Cookie(githubSSOCookie(state))
	if err != nil || browserID == "" || subtle.ConstantTimeCompare([]byte(attempt.BrowserID), []byte(browserID)) != 1 {
		return "", "", errors.New("incorrect or expired SSO browser state")
	}
	// Atomic removal permits only one token exchange, including concurrent callbacks.
	delete(githubSSOAttempts, state)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(githubSSOCookie(state), "", -1, "/", "", true, true)
	return attempt.Method, attempt.Verifier, nil
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
