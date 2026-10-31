package conf

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
)

// Default ports for the two LDAP transports. The setting is one free-text box, and
// an address without a port is the natural thing to type into it, so the scheme
// picks the port instead of letting the dial fail.
const (
	defaultLdapPort    = "389"
	defaultLdapTLSPort = "636"
)

// LdapDialTarget turns the raw `ldap_server` setting into the host:port that
// ldap.Dial expects, and says which transport to use.
//
// The value is operator-supplied free text, so the errors name the setting rather
// than the internal call: nobody reading "missing address" in a login toast would
// guess that the empty box in Settings > LDAP is what produced it.
func LdapDialTarget(raw string) (addr string, tlsEnabled bool, err error) {
	value := strings.TrimSpace(raw)
	port := defaultLdapPort
	switch {
	case strings.HasPrefix(value, "ldaps://"):
		tlsEnabled = true
		port = defaultLdapTLSPort
		value = strings.TrimPrefix(value, "ldaps://")
	case strings.HasPrefix(value, "ldap://"):
		value = strings.TrimPrefix(value, "ldap://")
	case strings.Contains(value, "://"):
		scheme := value[:strings.Index(value, "://")]
		return "", false, fmt.Errorf("%s is not a supported LDAP scheme; %s takes ldap:// or ldaps://", scheme, LdapServer)
	}
	if value == "" {
		return "", false, fmt.Errorf("%s %q names no server; give an address such as ldap://directory.example.com", LdapServer, raw)
	}
	if strings.Contains(value, "/") {
		return "", false, fmt.Errorf("%s %q has a path; give a host or host:port", LdapServer, raw)
	}
	// A bare host — and a bare IPv6 literal, which already contains colons — gets
	// the port its scheme implies.
	if !strings.Contains(value, ":") || net.ParseIP(value) != nil ||
		(strings.HasPrefix(value, "[") && strings.HasSuffix(value, "]")) {
		value = net.JoinHostPort(strings.Trim(value, "[]"), port)
	}
	host, port, err := net.SplitHostPort(value)
	if err != nil {
		return "", false, fmt.Errorf("%s %q is not a host:port address: %v", LdapServer, raw, err)
	}
	if host == "" {
		return "", false, fmt.Errorf("%s %q has no host; give the LDAP server address", LdapServer, raw)
	}
	if port == "" {
		return "", false, fmt.Errorf("%s %q has no port; give host:port, or just the host for the default", LdapServer, raw)
	}
	// The address is free text, so a stray word after the colon is caught here rather
	// than as a resolver failure inside the connection error.
	if _, err := strconv.Atoi(port); err != nil {
		return "", false, fmt.Errorf("%s %q has a port that is not a number; give host:port, or just the host for the default", LdapServer, raw)
	}
	return net.JoinHostPort(host, port), tlsEnabled, nil
}

// LdapSignInProblem returns nil when the LDAP settings describe a server that can
// actually authenticate somebody, and the first reason it cannot otherwise.
//
// Only the prerequisites for a meaningful connection are checked. The search base
// is deliberately not one of them: some directories answer a search from the root,
// and calling such a deployment unusable would switch off the only sign-in its
// users have. A missing address is different in kind — there is nothing to connect
// to — and a filter without a %s placeholder never carries the username that was
// typed, so it cannot authenticate anyone either.
func LdapSignInProblem(enabled bool, server, searchFilter string) error {
	if !enabled {
		return errors.New("LDAP sign-in is not enabled")
	}
	if _, _, err := LdapDialTarget(server); err != nil {
		return err
	}
	if !strings.Contains(searchFilter, "%s") {
		return fmt.Errorf("%s %q has no %%s placeholder, so the username typed is never sent to the directory",
			LdapUserSearchFilter, searchFilter)
	}
	return nil
}
