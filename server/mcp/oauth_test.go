package mcp

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	jose "gopkg.in/go-jose/go-jose.v2"
	"gopkg.in/go-jose/go-jose.v2/jwt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

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

func TestOAuthVerifierSurvivesCancellationAndKeyRotation(t *testing.T) {
	first, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	second, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	current := jose.JSONWebKey{Key: &first.PublicKey, KeyID: "first", Algorithm: "RS256", Use: "sig"}
	var issuer string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/.well-known/openid-configuration" {
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "jwks_uri": issuer + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"}})
			return
		}
		if r.URL.Path != "/keys" {
			http.NotFound(w, r)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{current}})
	}))
	defer server.Close()
	issuer = server.URL
	defer oauthVerifiers.Delete(issuer + "\x00authenticated")
	verifier, err := oauthVerifier(issuer, "authenticated")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	_, _ = verifier.Verify(ctx, "invalid-token")
	cancel()
	token := func(key *rsa.PrivateKey, kid, iss, aud string, expiry time.Time) string {
		signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: kid}}, nil)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := jwt.Signed(signer).Claims(jwt.Claims{Issuer: iss, Subject: "linked-user", Audience: jwt.Audience{aud}, Expiry: jwt.NewNumericDate(expiry)}).CompactSerialize()
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	if _, err := verifier.Verify(context.Background(), token(first, "first", issuer, "authenticated", time.Now().Add(time.Hour))); err != nil {
		t.Fatalf("verification after canceled request: %v", err)
	}
	mu.Lock()
	current = jose.JSONWebKey{Key: &second.PublicKey, KeyID: "second", Algorithm: "RS256", Use: "sig"}
	mu.Unlock()
	cached, err := oauthVerifier(issuer, "authenticated")
	if err != nil || cached != verifier {
		t.Fatal("verifier was not cached")
	}
	if _, err := cached.Verify(context.Background(), token(second, "second", issuer, "authenticated", time.Now().Add(time.Hour))); err != nil {
		t.Fatalf("key rotation: %v", err)
	}
	for _, tc := range []struct {
		name, iss, aud string
		expiry         time.Time
	}{
		{"wrong issuer", issuer + "/other", "authenticated", time.Now().Add(time.Hour)},
		{"wrong audience", issuer, "unrelated", time.Now().Add(time.Hour)},
		{"expired", issuer, "authenticated", time.Now().Add(-time.Hour)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := cached.Verify(context.Background(), token(second, "second", tc.iss, tc.aud, tc.expiry)); err == nil {
				t.Fatal("invalid token accepted")
			}
		})
	}
}

func TestOAuthClientRequiresExplicitApproval(t *testing.T) {
	for _, tc := range []struct {
		client, allowed string
		want            bool
	}{
		{"approved-client", "approved-client", true},
		{"approved-client", "first, approved-client ", true},
		{"unrelated-client", "approved-client", false},
		{"approved-client", "", false},
		{"", "", false},
		{"approved-client-suffix", "approved-client", false},
	} {
		if got := allowedOAuthClient(tc.client, tc.allowed); got != tc.want {
			t.Errorf("client %q allowlist %q = %v", tc.client, tc.allowed, got)
		}
	}
}
