package server

import (
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/server/common"
)

// ldapSignInAvailable is the protocol-server question: may this credential be
// offered to the directory at all.
//
// The LDAP settings are operator-supplied and can be only half-filled, and the
// fallback sites below overwrite the local password error with whatever the
// directory attempt returns. Gating on the settings being usable keeps a
// half-configured directory from turning "wrong password" into a connection error —
// and from opening a socket for every mistyped password a client sends.
func ldapSignInAvailable() bool {
	return setting.LdapSignInProblem() == nil
}

func tryLdapLoginAndRegister(user, pass string) (*model.User, error) {
	err := common.HandleLdapLogin(user, pass)
	if err != nil {
		return nil, err
	}
	return common.LdapRegister(user)
}
