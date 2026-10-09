package mcp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/gin-gonic/gin"
)

func TestProtectedResourceMetadataRequiresOAuthConfiguration(t *testing.T) {
	old := conf.Conf
	defer func() { conf.Conf = old }()
	conf.Conf = conf.DefaultConfig(t.TempDir())

	r := gin.New()
	r.GET("/.well-known/oauth-protected-resource/mcp", ProtectedResourceMetadata)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource/mcp", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
}

func TestProtectedResourceMetadataUsesCanonicalResourceAndIssuer(t *testing.T) {
	old := conf.Conf
	defer func() { conf.Conf = old }()
	conf.Conf = conf.DefaultConfig(t.TempDir())
	conf.Conf.MCP.Enable = true
	conf.Conf.MCP.OAuthIssuer = "https://example.supabase.co/auth/v1/"
	conf.Conf.SiteURL = "https://open-box.example/"

	r := gin.New()
	r.GET("/.well-known/oauth-protected-resource/mcp", ProtectedResourceMetadata)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://internal/.well-known/oauth-protected-resource/mcp", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	var metadata map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["resource"] != "https://open-box.example/mcp" {
		t.Fatalf("resource = %#v", metadata["resource"])
	}
	servers, ok := metadata["authorization_servers"].([]any)
	if !ok || len(servers) != 1 || servers[0] != "https://example.supabase.co/auth/v1" {
		t.Fatalf("authorization_servers = %#v", metadata["authorization_servers"])
	}
	methods, ok := metadata["bearer_methods_supported"].([]any)
	if !ok || len(methods) != 1 || methods[0] != "header" {
		t.Fatalf("bearer_methods_supported = %#v", metadata["bearer_methods_supported"])
	}
}

func TestAuthMCPChallengesMissingBearerToken(t *testing.T) {
	old := conf.Conf
	defer func() { conf.Conf = old }()
	conf.Conf = conf.DefaultConfig(t.TempDir())
	conf.Conf.MCP.Enable = true
	conf.Conf.MCP.OAuthIssuer = "https://example.supabase.co/auth/v1"
	conf.Conf.SiteURL = "https://open-box.example"

	r := gin.New()
	r.GET("/mcp", AuthMCP, func(c *gin.Context) { c.Status(http.StatusNoContent) })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://internal/mcp", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
	challenge := w.Header().Get("WWW-Authenticate")
	if !strings.Contains(challenge, "Bearer") || !strings.Contains(challenge, "https://open-box.example/.well-known/oauth-protected-resource/mcp") {
		t.Fatalf("unexpected challenge: %q", challenge)
	}
}
