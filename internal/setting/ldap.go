package setting

import (
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
)

// LdapSignInProblem reports why LDAP sign-in cannot be offered from the current
// settings, or nil when it can.
//
// Every surface that would hand a person to a directory asks the same question —
// the login route, the protocol servers that fall back to LDAP, and the public
// settings the sign-in page reads to decide how to sign in at all. This is that one
// question; the rules behind it are in conf.LdapSignInProblem.
func LdapSignInProblem() error {
	return conf.LdapSignInProblem(
		GetBool(conf.LdapLoginEnabled),
		GetStr(conf.LdapServer),
		GetStr(conf.LdapUserSearchFilter),
	)
}
