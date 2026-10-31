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

const reachedHandler = "reached the handler"

type authOutcome struct {
	reached bool // the middleware called next, so the credential authenticated
	code    int  // the logical code in the API envelope, 0 when there was none
	message string
}

// authAs sends a request through the real middleware. OpenList answers failures
// with HTTP 200 and carries the status inside the JSON envelope, so the logical
// code — not the transport status — is what has to be asserted; asserting
// `w.Code != 200` would pass for every credential, good or broken.
func authAs(t *testing.T, authorization string) authOutcome {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/x", middlewares.Auth(false), func(c *gin.Context) {
		c.String(http.StatusOK, reachedHandler)
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/x", nil)
	req.Header.Set("Authorization", authorization)
	r.ServeHTTP(w, req)
	body := strings.TrimSpace(w.Body.String())
	if body == reachedHandler {
		return authOutcome{reached: true, code: http.StatusOK}
	}
	var env struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("neither the handler nor an API envelope: http %d body %q", w.Code, body)
	}
	return authOutcome{code: env.Code, message: env.Message}
}

// The middleware used to compare the Authorization header verbatim, so a client
// that sent the "Bearer " scheme — every MCP server, ChatGPT plugin and Composio
// toolkit that issues a developer token — was handed to session parsing and told
// "that's not even a token". Integration clients could not tell a bad token apart
// from a token the server refused to read at all.
func TestBearerSchemeReachesTheAccessTokenPath(t *testing.T) {
	for _, authorization := range []string{"obk_notissued", "Bearer obk_notissued", "bearer  obk_notissued"} {
		out := authAs(t, authorization)
		if out.reached {
			t.Fatalf("%q: an unissued access token authenticated", authorization)
		}
		if out.code != http.StatusUnauthorized {
			t.Fatalf("%q: expected logical 401, got %+v", authorization, out)
		}
		if !strings.Contains(out.message, "access token") {
			t.Fatalf("%q: expected the access-token rejection, got %q", authorization, out.message)
		}
	}
}

// The site token is the one credential that is compared rather than parsed, so
// no downstream normalization can cover it: automation that sends
// `Bearer <site token>` must reach the administrator branch, in every spelling.
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
		if out := authAs(t, authorization); !out.reached {
			t.Fatalf("%q: the site token did not authenticate, got %+v", authorization, out)
		}
	}
}

// Normalizing the scheme must not turn something that is not a credential into
// one, and a header that declares the scheme with nothing after it is not a
// guest request either — it is a rejected token.
func TestBearerSchemeDoesNotLoosenRejection(t *testing.T) {
	for _, authorization := range []string{"", "  ", "Bearer", "Bearer not-a-jwt", "not-a-jwt"} {
		out := authAs(t, authorization)
		switch authorization {
		case "", "  ":
			// No credential at all is the anonymous case; the guest user is not
			// seeded in this fixture, so it must fail as a guest problem, never
			// authenticate as a token.
			if out.reached {
				t.Fatalf("%q: an empty credential reached the handler", authorization)
			}
		default:
			if out.reached {
				t.Fatalf("%q: an unusable credential authenticated", authorization)
			}
			if out.code != http.StatusUnauthorized {
				t.Fatalf("%q: expected logical 401, got %+v", authorization, out)
			}
		}
	}
}
