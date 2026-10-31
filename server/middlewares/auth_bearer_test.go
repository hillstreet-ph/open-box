package middlewares_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/server/middlewares"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func init() {
	conf.Conf = conf.DefaultConfig("data")
	dB, err := gorm.Open(sqlite.Open("file::memory:?cache=shared&mode=memory"), &gorm.Config{})
	if err != nil {
		panic("failed to connect database")
	}
	db.Init(dB)
}

type authEnvelope struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// authAs runs an authenticated request through the real middleware and returns
// the API envelope. OpenList answers with HTTP 200 and the logical code in the
// body for some paths and with the status for others, so both are returned.
func authAs(t *testing.T, authorization string) (int, authEnvelope) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/x", middlewares.Auth(false), func(c *gin.Context) {
		c.String(http.StatusOK, "reached the handler")
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/x", nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	r.ServeHTTP(w, req)
	var env authEnvelope
	body := w.Body.String()
	if strings.HasPrefix(strings.TrimSpace(body), "{") {
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatalf("unreadable body %q: %v", body, err)
		}
	}
	return w.Code, env
}

// The middleware used to compare the Authorization header verbatim, so a client
// that sent the "Bearer " scheme — every MCP server, ChatGPT plugin and
// Composio toolkit that issues a developer token — was handed to session
// parsing and told "that's not even a token". The answer now has to come from
// the access-token path, in both spellings, or integration clients cannot tell
// a bad token apart from a token the server refuses to read at all.
func TestBearerSchemeReachesTheAccessTokenPath(t *testing.T) {
	for _, authorization := range []string{"obk_notissued", "Bearer obk_notissued", "bearer  obk_notissued"} {
		status, env := authAs(t, authorization)
		if status != http.StatusUnauthorized && env.Code != http.StatusUnauthorized {
			t.Fatalf("%q: expected a 401, got http %d body %+v", authorization, status, env)
		}
		if !strings.Contains(env.Message, "access token") {
			t.Fatalf("%q: expected the access-token rejection, got %q", authorization, env.Message)
		}
	}
}

// A scheme prefix must not turn something that is not a credential into one:
// an unparseable session in either form is still refused, and an empty header
// is still the guest signal rather than a token named "Bearer".
func TestBearerSchemeDoesNotLoosenRejection(t *testing.T) {
	for _, authorization := range []string{"Bearer not-a-jwt", "not-a-jwt", "Bearer"} {
		status, env := authAs(t, authorization)
		if status == http.StatusOK && env.Code == 200 {
			t.Fatalf("%q: an unusable credential authenticated", authorization)
		}
	}
}

// The site token is the one credential that is compared, not parsed, so it is
// the case the access-token and session normalizations cannot cover: an
// operator's automation that sends `Bearer <site token>` used to miss the
// comparison entirely and then fail as a malformed JWT.
func TestSiteTokenAuthenticatesInBothForms(t *testing.T) {
	const siteToken = "unit-test-site-token"
	admin := &model.User{Username: "bearer-site-admin", Role: model.ADMIN, PwdTS: time.Now().Unix()}
	if err := op.CreateUser(admin); err != nil {
		t.Fatalf("failed to create an administrator: %+v", err)
	}
	if err := op.SaveSettingItem(&model.SettingItem{
		Key:   conf.Token,
		Value: siteToken,
		Type:  conf.TypeString,
		Group: model.SINGLE,
		Flag:  model.PRIVATE,
	}); err != nil {
		t.Fatalf("failed to store the site token: %+v", err)
	}
	for _, authorization := range []string{siteToken, "Bearer " + siteToken, "bearer  " + siteToken} {
		status, _ := authAs(t, authorization)
		if status != http.StatusOK {
			t.Fatalf("%q: the site token did not authenticate, got http %d", authorization, status)
		}
	}
}
