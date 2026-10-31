package common

import (
	"errors"
	"strings"
	"testing"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
)

// The settings-backed database is the one the package harness in auth_test.go opens.

func putLdapSetting(t *testing.T, key, value, typ string) {
	t.Helper()
	item := &model.SettingItem{Key: key, Value: value, Type: typ, Group: model.LDAP, Flag: model.PRIVATE}
	if err := op.SaveSettingItem(item); err != nil {
		t.Fatalf("failed to store %s: %v", key, err)
	}
	t.Cleanup(func() {
		// op.DeleteSettingItemByKey only deletes deprecated rows, so the test row goes
		// through the db layer and the cache is dropped by hand.
		if err := db.DeleteSettingItemByKey(key); err != nil {
			t.Errorf("cleanup of %s failed: %v", key, err)
		}
		op.SettingCacheUpdate()
	})
}

// HandleLdapLogin is shared by the HTTP route and by the WebDAV, FTP and SFTP
// fallbacks, where whatever it returns replaces the error the local password check
// produced. So it has to answer for itself when there is no directory to ask: a
// socket error handed back as if it were about the caller's credential — and one
// connection attempt for every mistyped password.
func TestHandleLdapLoginRefusesToDialAnUnconfiguredDirectory(t *testing.T) {
	cases := []struct {
		name    string
		enabled string
		server  string
		sub     string
	}{
		{name: "sign-in by directory is off", enabled: "false", server: "", sub: "not enabled"},
		{name: "on with no address", enabled: "true", server: "", sub: conf.LdapServer},
		{name: "on with only a scheme", enabled: "true", server: "ldaps://", sub: conf.LdapServer},
	}
	putLdapSetting(t, conf.LdapUserSearchFilter, "(uid=%s)", conf.TypeString)
	for _, c := range cases {
		putLdapSetting(t, conf.LdapLoginEnabled, c.enabled, conf.TypeBool)
		putLdapSetting(t, conf.LdapServer, c.server, conf.TypeString)

		err := HandleLdapLogin("whoever", "whatever")
		if err == nil {
			t.Errorf("%s: HandleLdapLogin returned nil, want it to refuse", c.name)
			continue
		}
		if !strings.Contains(err.Error(), c.sub) {
			t.Errorf("%s: error = %q, want it to mention %q", c.name, err, c.sub)
		}
		if strings.Contains(err.Error(), "dial tcp") {
			t.Errorf("%s: error = %q, want no transport error — nothing should be dialed", c.name, err)
		}
		// The lockout guard counts a failed directory bind, so a configuration that
		// cannot bind anybody must not be reported as one.
		if errors.Is(err, ErrFailedLdapAuth) {
			t.Errorf("%s: %q is marked as a failed authentication; nobody was authenticated or rejected", c.name, err)
		}
	}
}
