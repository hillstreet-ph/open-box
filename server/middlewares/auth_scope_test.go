package middlewares_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/OpenListTeam/OpenList/v4/server/middlewares"
	"github.com/gin-gonic/gin"
)

// runWithScopes builds a request whose context carries the given PAT
// scopes (nil models a session-authenticated request).
type apiResp struct {
	Code int `json:"code"`
}

// runWithScopes returns the logical API code, since OpenList responds with
// HTTP 200 and carries the status in the JSON body.
func runWithScopes(t *testing.T, mw gin.HandlerFunc, scopes []string) int {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if scopes != nil {
			common.GinAppendValues(c, conf.TokenScopeKey, scopes)
		}
		c.Next()
	})
	r.GET("/x", mw, func(c *gin.Context) {
		common.SuccessResp(c)
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/x", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("unexpected http status %d", w.Code)
	}
	var resp apiResp
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad body %q: %v", w.Body.String(), err)
	}
	return resp.Code
}

func TestAuthScopeAllowsSession(t *testing.T) {
	if code := runWithScopes(t, middlewares.AuthScope("fs:read"), nil); code != http.StatusOK {
		t.Fatalf("session request (no scopes in context) should pass, got %d", code)
	}
}

func TestAuthScopeEnforcesTokenScope(t *testing.T) {
	if code := runWithScopes(t, middlewares.AuthScope("fs:read"), []string{"fs:read"}); code != http.StatusOK {
		t.Fatalf("scoped token should pass, got %d", code)
	}
	if code := runWithScopes(t, middlewares.AuthScope("fs:write"), []string{"fs:read"}); code != http.StatusForbidden {
		t.Fatalf("token missing scope should be forbidden, got %d", code)
	}
}

func TestRequireSessionRejectsTokens(t *testing.T) {
	if code := runWithScopes(t, middlewares.RequireSession, []string{"fs:read"}); code != http.StatusForbidden {
		t.Fatalf("PAT request should be rejected on session-only routes, got %d", code)
	}
	if code := runWithScopes(t, middlewares.RequireSession, nil); code != http.StatusOK {
		t.Fatalf("session request should pass, got %d", code)
	}
}
