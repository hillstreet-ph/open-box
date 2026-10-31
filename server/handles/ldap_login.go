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
	// Enabled is not the same as usable. The sign-in page routes the Login button here
	// whenever the public flag is on, so an enabled directory with no address is a
	// reply of "Failed to connect to LDAP: dial tcp: missing address" for everybody —
	// including the administrator, who meant to type a password. Name the setting that
	// is missing, before a socket is involved.
	if err := setting.LdapSignInProblem(); err != nil {
		if !setting.GetBool(conf.LdapLoginEnabled) {
			common.ErrorStrResp(c, "ldap is not enabled", 403)
			return
		}
		// Not the visitor's fault, so the attempt guard stays out of it.
		common.ErrorStrResp(c, err.Error(), 500)
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
