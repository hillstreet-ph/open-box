package handles

import (
	"strconv"
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

type TokenCreateReq struct {
	Name      string   `json:"name" binding:"required"`
	Scopes    []string `json:"scopes" binding:"required"`
	ExpiresIn int      `json:"expires_in"` // hours; 0 or negative means no expiry
}

// requireSession rejects PAT-authenticated requests: token management must
// happen with a login session so a leaked low-scope token cannot mint
// higher-scope tokens.
func requireSession(c *gin.Context) bool {
	if c.Request.Context().Value(conf.TokenScopeKey) != nil {
		common.ErrorStrResp(c, "manage tokens with your login session", 403)
		c.Abort()
		return false
	}
	return true
}

func CreateMyToken(c *gin.Context) {
	userObj, ok := c.Request.Context().Value(conf.UserKey).(*model.User)
	if !ok || userObj.IsGuest() {
		common.ErrorStrResp(c, "user invalid", 401)
		return
	}
	if !requireSession(c) {
		return
	}
	var req TokenCreateReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorStrResp(c, "request invalid", 400)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		common.ErrorStrResp(c, "name invalid", 400)
		return
	}
	if len(req.Name) > 64 {
		common.ErrorStrResp(c, "name too long (max 64 chars)", 400)
		return
	}
	if invalid := model.ValidateScopes(req.Scopes); len(invalid) > 0 {
		common.ErrorStrResp(c, "invalid scopes: "+strings.Join(invalid, ", "), 400)
		return
	}
	raw, hash, prefix, err := common.GeneratePAT()
	if err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	token := &model.AccessToken{
		UserId:    userObj.ID,
		Name:      req.Name,
		Prefix:    prefix,
		TokenHash: hash,
		Scopes:    strings.Join(req.Scopes, ","),
	}
	if req.ExpiresIn > 0 {
		expiresAt := time.Now().Add(time.Duration(req.ExpiresIn) * time.Hour)
		token.ExpiresAt = &expiresAt
	}
	if err := op.CreateAccessToken(token); err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	// The raw token is returned exactly once and is never persisted.
	common.SuccessResp(c, gin.H{
		"token":      raw,
		"id":         token.ID,
		"name":       token.Name,
		"prefix":     token.Prefix,
		"scopes":     token.ScopeList(),
		"expires_at": token.ExpiresAt,
	})
}

func ListMyTokens(c *gin.Context) {
	userObj, ok := c.Request.Context().Value(conf.UserKey).(*model.User)
	if !ok || userObj.IsGuest() {
		common.ErrorStrResp(c, "user invalid", 401)
		return
	}
	if !requireSession(c) {
		return
	}
	var req model.PageReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	req.Validate()
	tokens, total, err := op.GetAccessTokensByUserId(userObj.ID, req.Page, req.PerPage)
	if err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	common.SuccessResp(c, common.PageResp{
		Content: tokens,
		Total:   total,
	})
}

func RevokeMyToken(c *gin.Context) {
	userObj, ok := c.Request.Context().Value(conf.UserKey).(*model.User)
	if !ok || userObj.IsGuest() {
		common.ErrorStrResp(c, "user invalid", 401)
		return
	}
	if !requireSession(c) {
		return
	}
	tokenId, err := strconv.Atoi(c.Query("id"))
	if err != nil {
		common.ErrorStrResp(c, "id format invalid", 400)
		return
	}
	token, err := op.GetAccessTokenByIdAndUserId(uint(tokenId), userObj.ID)
	if err != nil {
		common.ErrorStrResp(c, "failed to get access token", 404)
		return
	}
	if err := op.RevokeAccessToken(token); err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	common.SuccessResp(c)
}
