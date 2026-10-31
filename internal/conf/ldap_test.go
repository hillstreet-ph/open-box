package conf

import (
	"strings"
	"testing"
)

func TestLdapDialTargetAcceptsWhatAnOperatorTypes(t *testing.T) {
	cases := []struct {
		raw        string
		wantAddr   string
		wantTLS    bool
		wantErrSub string // empty means the address is usable
	}{
		// A host with no port is the natural thing to write in a single text box, and
		// the scheme picks the port instead of letting the dial fail.
		{raw: "directory.example.com", wantAddr: "directory.example.com:389"},
		{raw: "ldap://directory.example.com", wantAddr: "directory.example.com:389"},
		{raw: "ldaps://directory.example.com", wantAddr: "directory.example.com:636", wantTLS: true},
		{raw: "  ldap://directory.example.com  ", wantAddr: "directory.example.com:389"},
		{raw: "directory.example.com:1389", wantAddr: "directory.example.com:1389"},
		{raw: "ldaps://directory.example.com:6636", wantAddr: "directory.example.com:6636", wantTLS: true},
		// IPv6 needs its brackets once a port is attached, typed or implied.
		{raw: "::1", wantAddr: "[::1]:389"},
		{raw: "ldap://[::1]", wantAddr: "[::1]:389"},
		{raw: "[::1]:1389", wantAddr: "[::1]:1389"},

		// Every one of these used to reach ldap.Dial and come back as a transport error
		// that the person at the login page cannot act on.
		{raw: "", wantErrSub: "names no server"},
		{raw: "   ", wantErrSub: "names no server"},
		{raw: "ldap://", wantErrSub: "names no server"},
		{raw: "ldaps://", wantErrSub: "names no server"},
		{raw: ":1389", wantErrSub: "has no host"},
		{raw: "ldap://:1389", wantErrSub: "has no host"},
		{raw: "directory.example.com:", wantErrSub: "has no port"},
		{raw: "directory.example.com:ldaps", wantErrSub: "not a number"},
		{raw: "directory.example.com/dc=example", wantErrSub: "has a path"},
		{raw: "http://directory.example.com", wantErrSub: "not a supported LDAP scheme"},
	}
	for _, c := range cases {
		addr, tlsEnabled, err := LdapDialTarget(c.raw)
		if c.wantErrSub == "" {
			if err != nil {
				t.Errorf("LdapDialTarget(%q) = error %v, want %q", c.raw, err, c.wantAddr)
				continue
			}
			if addr != c.wantAddr || tlsEnabled != c.wantTLS {
				t.Errorf("LdapDialTarget(%q) = (%q, tls=%v), want (%q, tls=%v)",
					c.raw, addr, tlsEnabled, c.wantAddr, c.wantTLS)
			}
			continue
		}
		if err == nil {
			t.Errorf("LdapDialTarget(%q) = (%q, tls=%v), want an error mentioning %q",
				c.raw, addr, tlsEnabled, c.wantErrSub)
			continue
		}
		if !strings.Contains(err.Error(), c.wantErrSub) {
			t.Errorf("LdapDialTarget(%q) error = %v, want it to mention %q", c.raw, err, c.wantErrSub)
		}
		// The setting key has to appear: the message is read by someone looking at a
		// login page, not at this file.
		if !strings.Contains(err.Error(), LdapServer) {
			t.Errorf("LdapDialTarget(%q) error = %v, want it to name the %q setting", c.raw, err, LdapServer)
		}
	}
}

func TestLdapSignInProblemStopsAtWhatCannotWork(t *testing.T) {
	const usableFilter = "(uid=%s)"
	cases := []struct {
		name        string
		enabled     bool
		server      string
		filter      string
		wantProblem bool
		wantSub     string
	}{
		{name: "off is simply off", enabled: false, server: "directory.example.com",
			filter: usableFilter, wantProblem: true, wantSub: "not enabled"},
		{name: "on with the address left blank", enabled: true, server: "",
			filter: usableFilter, wantProblem: true, wantSub: LdapServer},
		{name: "on with a scheme but no host", enabled: true, server: "ldap://",
			filter: usableFilter, wantProblem: true, wantSub: LdapServer},
		// The filter is the only other hard requirement: without the placeholder the
		// username typed never reaches the directory, so nothing can be authenticated.
		{name: "on with a filter that drops the username", enabled: true, server: "directory.example.com",
			filter: "(objectClass=person)", wantProblem: true, wantSub: LdapUserSearchFilter},
		{name: "on with an empty filter", enabled: true, server: "directory.example.com",
			filter: "", wantProblem: true, wantSub: LdapUserSearchFilter},
		{name: "a complete configuration is usable", enabled: true, server: "ldaps://directory.example.com",
			filter: "(&(objectClass=user)(sAMAccountName=%s))"},
		// The search base is not a parameter at all: some directories answer a search
		// from the root, and calling them unusable would switch off the only sign-in
		// those users have.
	}
	for _, c := range cases {
		err := LdapSignInProblem(c.enabled, c.server, c.filter)
		if !c.wantProblem {
			if err != nil {
				t.Errorf("%s: LdapSignInProblem(%v, %q, %q) = %v, want nil",
					c.name, c.enabled, c.server, c.filter, err)
			}
			continue
		}
		if err == nil {
			t.Errorf("%s: LdapSignInProblem(%v, %q, %q) = nil, want an error mentioning %q",
				c.name, c.enabled, c.server, c.filter, c.wantSub)
			continue
		}
		if !strings.Contains(err.Error(), c.wantSub) {
			t.Errorf("%s: error = %v, want it to mention %q", c.name, err, c.wantSub)
		}
	}
}
