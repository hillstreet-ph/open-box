package mcp

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/coreos/go-oidc"
	"github.com/gin-gonic/gin"
)

var oauthVerifiers sync.Map

func allowedOAuthClient(clientID, allowlist string) bool {
	if clientID == "" {
		return false
	}
	for _, approved := range strings.Split(allowlist, ",") {
		if strings.TrimSpace(approved) == clientID {
			return true
		}
	}
	return false
}

func oauthVerifier(issuer, audience string) (*oidc.IDTokenVerifier, error) {
	key := issuer + "\x00" + audience
	if cached, ok := oauthVerifiers.Load(key); ok {
		return cached.(*oidc.IDTokenVerifier), nil
	}
	// go-oidc retains this context for future JWKS refreshes. A request context
	// would invalidate the cached verifier after the first request completes.
	providerCtx := oidc.ClientContext(context.Background(), &http.Client{Timeout: 10 * time.Second})
	provider, err := oidc.NewProvider(providerCtx, issuer)
	if err != nil {
		return nil, err
	}
	verifier := provider.Verifier(&oidc.Config{ClientID: audience})
	actual, _ := oauthVerifiers.LoadOrStore(key, verifier)
	return actual.(*oidc.IDTokenVerifier), nil
}

func ProtectedResourceMetadata(c *gin.Context) {
	if conf.Conf == nil || !conf.Conf.MCP.Enable || strings.TrimSpace(conf.Conf.MCP.OAuthIssuer) == "" {
		c.Status(http.StatusNotFound)
		return
	}
	c.JSON(http.StatusOK, map[string]any{
		"resource":                 canonicalResourceURL(c),
		"authorization_servers":    []string{strings.TrimRight(conf.Conf.MCP.OAuthIssuer, "/")},
		"bearer_methods_supported": []string{"header"},
	})
}

func canonicalResourceURL(c *gin.Context) string {
	if conf.Conf != nil && strings.TrimSpace(conf.Conf.SiteURL) != "" {
		return strings.TrimRight(conf.Conf.SiteURL, "/") + "/mcp"
	}
	scheme := "https"
	if c.Request.TLS == nil {
		scheme = "http"
	}
	return scheme + "://" + c.Request.Host + "/mcp"
}

func authenticationChallenge(c *gin.Context) {
	if conf.Conf == nil || strings.TrimSpace(conf.Conf.MCP.OAuthIssuer) == "" {
		return
	}
	metadataURL := strings.TrimRight(conf.Conf.SiteURL, "/") + "/.well-known/oauth-protected-resource/mcp"
	if strings.TrimSpace(conf.Conf.SiteURL) == "" {
		scheme := "https"
		if c.Request.TLS == nil {
			scheme = "http"
		}
		metadataURL = scheme + "://" + c.Request.Host + "/.well-known/oauth-protected-resource/mcp"
	}
	c.Header("WWW-Authenticate", "Bearer resource_metadata=\""+metadataURL+"\"")
}

func AuthMCP(c *gin.Context) {
	raw := strings.TrimSpace(c.GetHeader("Authorization"))
	token := raw
	if strings.HasPrefix(strings.ToLower(raw), "bearer ") {
		token = strings.TrimSpace(raw[len("Bearer "):])
	}
	if token == "" || strings.ContainsAny(token, " \t\r\n") {
		authenticationChallenge(c)
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	if token == setting.GetStr(conf.Token) {
		user, err := op.GetAdmin()
		if err == nil && user != nil && !user.Disabled {
			common.GinAppendValues(c, conf.UserKey, user)
			c.Next()
			return
		}
	}

	if claims, err := common.ParseToken(token); err == nil {
		user, userErr := op.GetUserByName(claims.Username)
		if userErr == nil && user != nil && !user.Disabled && !user.IsGuest() && claims.PwdTS == user.PwdTS {
			common.GinAppendValues(c, conf.UserKey, user)
			c.Next()
			return
		}
	}

	user, err := authenticateSupabaseUser(c.Request.Context(), token)
	if err == nil && user != nil && !user.Disabled && !user.IsGuest() {
		common.GinAppendValues(c, conf.UserKey, user)
		c.Next()
		return
	}

	authenticationChallenge(c)
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
}

func authenticateSupabaseUser(ctx context.Context, rawToken string) (*model.User, error) {
	if conf.Conf == nil || !conf.Conf.MCP.Enable {
		return nil, errors.New("MCP OAuth is disabled")
	}
	issuer := strings.TrimRight(strings.TrimSpace(conf.Conf.MCP.OAuthIssuer), "/")
	audience := strings.TrimSpace(conf.Conf.MCP.OAuthAudience)
	if issuer == "" || audience == "" {
		return nil, errors.New("MCP OAuth is not configured")
	}

	verifier, err := oauthVerifier(issuer, audience)
	if err != nil {
		return nil, err
	}

	verifyCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	idToken, err := verifier.Verify(verifyCtx, rawToken)
	if err != nil || idToken.Subject == "" {
		return nil, errors.New("invalid Supabase access token")
	}
	var claims struct {
		ClientID string `json:"client_id"`
	}
	if err := idToken.Claims(&claims); err != nil || strings.TrimSpace(claims.ClientID) == "" {
		return nil, errors.New("token is not an OAuth client token")
	}
	if !allowedOAuthClient(claims.ClientID, conf.Conf.MCP.OAuthAllowedClientIDs) {
		return nil, errors.New("OAuth client is not approved for MCP")
	}

	// Open-Box accounts must be explicitly linked by SSO ID; OAuth never auto-creates users.
	user, err := db.GetUserBySSOID(idToken.Subject)
	if err != nil {
		return nil, err
	}
	return user, nil
}
