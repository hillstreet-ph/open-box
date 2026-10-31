package middlewares

import (
	"crypto/subtle"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

// Auth is a middleware that checks if the user is logged in.
// if token is empty, set user to guest
func Auth(allowDisabledGuest bool) func(c *gin.Context) {
	return func(c *gin.Context) {
		// Normalized once, so the site token, an access token and a session
		// JWT all resolve the same way whether or not the client sent the
		// "Bearer " scheme. See common.Credential.
		token := common.Credential(c.GetHeader("Authorization"))
		if subtle.ConstantTimeCompare([]byte(token), []byte(setting.GetStr(conf.Token))) == 1 {
			admin, err := op.GetAdmin()
			if err != nil {
				common.ErrorResp(c, err, 500)
				c.Abort()
				return
			}
			common.GinAppendValues(c, conf.UserKey, admin)
			log.Debugf("use admin token: %+v", admin)
			c.Next()
			return
		}
		if token == "" {
			guest, err := op.GetGuest()
			if err != nil {
				common.ErrorResp(c, err, 500)
				c.Abort()
				return
			}
			if !allowDisabledGuest && guest.Disabled {
				common.ErrorStrResp(c, "Guest user is disabled, login please", 401)
				c.Abort()
				return
			}
			common.GinAppendValues(c, conf.UserKey, guest)
			log.Debugf("use empty token: %+v", guest)
			c.Next()
			return
		}
		if common.IsPAT(token) {
			user, pat, err := common.ResolvePAT(token)
			if err != nil {
				common.ErrorStrResp(c, "Invalid or expired access token", 401)
				c.Abort()
				return
			}
			common.GinAppendValues(c, conf.UserKey, user, conf.TokenScopeKey, pat.ScopeList())
			log.Debugf("use access token: %s (user %s)", pat.Prefix, user.Username)
			c.Next()
			return
		}
		userClaims, err := common.ParseToken(token)
		if err != nil {
			common.ErrorResp(c, err, 401)
			c.Abort()
			return
		}
		user, err := op.GetUserByName(userClaims.Username)
		if err != nil {
			common.ErrorResp(c, err, 401)
			c.Abort()
			return
		}
		// validate password timestamp
		if userClaims.PwdTS != user.PwdTS {
			common.ErrorStrResp(c, "Password has been changed, login please", 401)
			c.Abort()
			return
		}
		if user.Disabled {
			common.ErrorStrResp(c, "Current user is disabled, replace please", 401)
			c.Abort()
			return
		}
		common.GinAppendValues(c, conf.UserKey, user)
		log.Debugf("use login token: %+v", user)
		c.Next()
	}
}

func Authn(c *gin.Context) {
	token := common.Credential(c.GetHeader("Authorization"))
	if subtle.ConstantTimeCompare([]byte(token), []byte(setting.GetStr(conf.Token))) == 1 {
		admin, err := op.GetAdmin()
		if err != nil {
			common.ErrorResp(c, err, 500)
			c.Abort()
			return
		}
		common.GinAppendValues(c, conf.UserKey, admin)
		log.Debugf("use admin token: %+v", admin)
		c.Next()
		return
	}
	if token == "" {
		guest, err := op.GetGuest()
		if err != nil {
			common.ErrorResp(c, err, 500)
			c.Abort()
			return
		}
		common.GinAppendValues(c, conf.UserKey, guest)
		log.Debugf("use empty token: %+v", guest)
		c.Next()
		return
	}
	if common.IsPAT(token) {
		user, pat, err := common.ResolvePAT(token)
		if err != nil {
			common.ErrorStrResp(c, "Invalid or expired access token", 401)
			c.Abort()
			return
		}
		common.GinAppendValues(c, conf.UserKey, user, conf.TokenScopeKey, pat.ScopeList())
		log.Debugf("use access token: %s (user %s)", pat.Prefix, user.Username)
		c.Next()
		return
	}
	userClaims, err := common.ParseToken(token)
	if err != nil {
		common.ErrorResp(c, err, 401)
		c.Abort()
		return
	}
	user, err := op.GetUserByName(userClaims.Username)
	if err != nil {
		common.ErrorResp(c, err, 401)
		c.Abort()
		return
	}
	// validate password timestamp
	if userClaims.PwdTS != user.PwdTS {
		common.ErrorStrResp(c, "Password has been changed, login please", 401)
		c.Abort()
		return
	}
	if user.Disabled {
		common.ErrorStrResp(c, "Current user is disabled, replace please", 401)
		c.Abort()
		return
	}
	common.GinAppendValues(c, conf.UserKey, user)
	log.Debugf("use login token: %+v", user)
	c.Next()
}

func AuthNotGuest(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if user.IsGuest() {
		common.ErrorStrResp(c, "You are a guest", 403)
		c.Abort()
	} else {
		c.Next()
	}
}

func AuthAdmin(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if !user.IsAdmin() {
		common.ErrorStrResp(c, "You are not an admin", 403)
		c.Abort()
	} else {
		c.Next()
	}
}

// AuthScope enforces that a request authenticated with a personal access
// token carries the given scope. Session (JWT) authentication is governed
// by role checks only and passes through.
func AuthScope(scope string) func(c *gin.Context) {
	return func(c *gin.Context) {
		v := c.Request.Context().Value(conf.TokenScopeKey)
		if v == nil {
			c.Next()
			return
		}
		scopes, ok := v.([]string)
		if !ok {
			c.Next()
			return
		}
		for _, s := range scopes {
			if s == scope {
				c.Next()
				return
			}
		}
		common.ErrorStrResp(c, "Access token is missing required scope: "+scope, 403)
		c.Abort()
	}
}

// RequireSession rejects requests authenticated with a personal access
// token. Account, admin, and token-management surfaces must be used with
// a login session so a leaked token cannot escalate privileges.
func RequireSession(c *gin.Context) {
	if c.Request.Context().Value(conf.TokenScopeKey) != nil {
		common.ErrorStrResp(c, "this endpoint requires a login session", 403)
		c.Abort()
		return
	}
	c.Next()
}
