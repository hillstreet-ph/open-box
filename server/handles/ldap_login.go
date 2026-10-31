package handles

import (
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

func LoginLdap(c *gin.Context) {
	var req LoginReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	enabled := setting.GetBool(conf.LdapLoginEnabled)
	if !enabled {
		common.ErrorStrResp(c, "ldap is not enabled", 403)
		return
	}
	user, err := op.GetUserByName(req.Username)
	if err == nil && !user.AllowLdap {
		common.ErrorStrResp(c, "login via ldap is not allowed", 403)
		return
	}

	// check count of login
	ip := c.ClientIP()
	if remaining, locked := model.LoginLocked(ip); locked {
		common.ErrorStrResp(c, model.TooManyAttemptsMessage(remaining), 429)
		return
	}

	err = common.HandleLdapLogin(req.Username, req.Password)
	if err != nil {
		if errors.Is(err, common.ErrFailedLdapAuth) {
			model.RecordLoginFailure(ip)
			common.ErrorResp(c, err, 400)
		} else {
			common.ErrorResp(c, err, 500)
		}
		return
	}

	if user == nil {
		user, err = common.LdapRegister(req.Username)
		if err != nil {
			common.ErrorResp(c, err, 400)
			model.RecordLoginFailure(ip)
			return
		}
	}

	// generate token
	token, err := common.GenerateToken(user)
	if err != nil {
		common.ErrorResp(c, err, 400, true)
		return
	}
	common.SuccessResp(c, gin.H{"token": token})
	model.ClearLoginAttempts(ip)
}
