package handles

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/gin-gonic/gin"
)

// The sign-in page reads ldap_login_enabled from /api/public/settings and sends the
// Login button to the LDAP route while it is true. With the flag on and the address
// box empty — the state a production database was actually found in — that means
// every visitor, the administrator included, is routed to a directory that cannot
// answer, and the password prompt is gone. The public flag therefore has to mean
// "LDAP sign-in is available", not "somebody ticked a box".

func putLdapSetting(t *testing.T, key, value, typ string, flag int) {
	t.Helper()
	item := &model.SettingItem{Key: key, Value: value, Type: typ, Group: model.LDAP, Flag: flag}
	if err := op.SaveSettingItem(item); err != nil {
		t.Fatalf("failed to store %s: %v", key, err)
	}
	t.Cleanup(func() {
		// op.DeleteSettingItemByKey only deletes deprecated rows, so the test row goes
		// through the db layer and the cache is dropped by hand.
		if err := db.DeleteSettingItemByKey(key); err != nil {
			t.Errorf("cleanup of %s failed: %v", key, err)
		}
		op.SettingCacheUpdate()
	})
}

func setLdap(t *testing.T, enabled, server, filter string) {
	t.Helper()
	putLdapSetting(t, conf.LdapLoginEnabled, enabled, conf.TypeBool, model.PUBLIC)
	putLdapSetting(t, conf.LdapServer, server, conf.TypeString, model.PRIVATE)
	putLdapSetting(t, conf.LdapUserSearchFilter, filter, conf.TypeString, model.PRIVATE)
}

// apiEnvelope is the answer of a routed handler. Failures come back as HTTP 200 with
// the status inside the body, so the transport code says nothing.
type apiEnvelope struct {
	code    int
	message string
}

func getPublicSettings(t *testing.T) map[string]string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/public/settings", PublicSettings)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/public/settings", nil))
	var env struct {
		Code    int               `json:"code"`
		Message string            `json:"message"`
		Data    map[string]string `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("public settings answer is not an API envelope: http %d body %q", w.Code, w.Body.String())
	}
	if env.Code != http.StatusOK {
		t.Fatalf("public settings call failed: code %d message %q", env.Code, env.Message)
	}
	return env.Data
}

func postLdapLogin(t *testing.T, ip string) apiEnvelope {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/auth/login/ldap", LoginLdap)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login/ldap",
		strings.NewReader(`{"username":"whoever","password":"whatever","otp_code":""}`))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = ip + ":54321"
	r.ServeHTTP(w, req)
	var env struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("neither an API envelope nor anything else: http %d body %q", w.Code, w.Body.String())
	}
	return apiEnvelope{code: env.Code, message: env.Message}
}

func TestPublicSettingsOnlyAdvertisesAnUsableLdap(t *testing.T) {
	usableFilter := "(uid=%s)"

	t.Run("enabled but no server configured", func(t *testing.T) {
		setLdap(t, "true", "", usableFilter)
		if got := getPublicSettings(t)[conf.LdapLoginEnabled]; got != "false" {
			t.Errorf("public ldap_login_enabled = %q, want \"false\": advertising it sends the sign-in page to a directory that does not exist", got)
		}
		// The operator's own setting is untouched: this is a statement about what the
		// outside world may rely on, not a silent repair of the configuration.
		if !setting.GetBool(conf.LdapLoginEnabled) {
			t.Error("the stored setting was rewritten; only the public view may change")
		}
	})

	t.Run("enabled and configured", func(t *testing.T) {
		setLdap(t, "true", "ldap://directory.example.com", usableFilter)
		if got := getPublicSettings(t)[conf.LdapLoginEnabled]; got != "true" {
			t.Errorf("public ldap_login_enabled = %q, want \"true\": a working directory must still offer its users a way in", got)
		}
	})

	t.Run("disabled", func(t *testing.T) {
		setLdap(t, "false", "ldap://directory.example.com", usableFilter)
		if got := getPublicSettings(t)[conf.LdapLoginEnabled]; got != "false" {
			t.Errorf("public ldap_login_enabled = %q, want \"false\"", got)
		}
	})
}

func TestLdapRouteNamesTheMissingSettingInsteadOfASocketError(t *testing.T) {
	usableFilter := "(uid=%s)"

	t.Run("enabled with no address", func(t *testing.T) {
		setLdap(t, "true", "", usableFilter)
		const ip = "203.0.113.41"
		got := postLdapLogin(t, ip)
		if got.code != http.StatusInternalServerError {
			t.Errorf("code = %d message = %q, want 500: an unconfigured directory is the service's problem, not the visitor's",
				got.code, got.message)
		}
		if !strings.Contains(got.message, conf.LdapServer) {
			t.Errorf("message = %q, want it to name the %s setting so the operator knows which box to fill",
				got.message, conf.LdapServer)
		}
		if strings.Contains(got.message, "dial tcp") {
			t.Errorf("message = %q, want no transport error: nothing should be dialed at all", got.message)
		}
		// A misconfiguration must not be charged to the person who tripped over it —
		// five of these was enough to lock a client out of an account they hold.
		if n := model.LoginFailures(ip); n != 0 {
			t.Errorf("failed attempts recorded for %s = %d, want 0", ip, n)
		}
		if _, locked := model.LoginLocked(ip); locked {
			t.Errorf("%s is locked out by a server-side configuration error", ip)
		}
	})

	t.Run("not enabled", func(t *testing.T) {
		setLdap(t, "false", "ldap://directory.example.com", usableFilter)
		got := postLdapLogin(t, "203.0.113.42")
		if got.code != http.StatusForbidden {
			t.Errorf("code = %d message = %q, want 403", got.code, got.message)
		}
		if !strings.Contains(got.message, "not enabled") {
			t.Errorf("message = %q, want it to say ldap is not enabled", got.message)
		}
	})
}
