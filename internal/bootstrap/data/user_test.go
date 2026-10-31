package data

import (
	"testing"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils/random"
)

func adminWithPassword(t *testing.T, password string) *model.User {
	t.Helper()
	salt := random.String(16)
	return &model.User{
		Username: "admin",
		Salt:     salt,
		PwdHash:  model.TwoHashPwd(password, salt),
		Role:     model.ADMIN,
	}
}

// Rotating OPENLIST_ADMIN_PASSWORD used to do nothing at all to an existing
// installation: the value is only read while the administrator row is created.
// Boot now says so, and only changes the account when asked to.
func TestDecideInitialPassword(t *testing.T) {
	admin := adminWithPassword(t, "current-password")

	tests := []struct {
		name           string
		admin          *model.User
		envpass        string
		resetRequested bool
		want           initialPasswordDecision
	}{
		{"no environment value", admin, "", false, initialPasswordUnchanged},
		{"no administrator yet", nil, "anything", true, initialPasswordUnchanged},
		{"value already matches", admin, "current-password", true, initialPasswordUnchanged},
		{"value matches and no reset requested", admin, "current-password", false, initialPasswordUnchanged},
		{"rotated value, no opt-in", admin, "rotated-password", false, initialPasswordIgnored},
		{"rotated value, opt-in", admin, "rotated-password", true, initialPasswordReset},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := decideInitialPassword(tt.admin, tt.envpass, tt.resetRequested); got != tt.want {
				t.Fatalf("decideInitialPassword() = %d, want %d", got, tt.want)
			}
		})
	}
}

// An opt-in switch that a stray value defeats is worse than none, so the reset
// flag accepts the usual spellings and nothing else.
func TestAdminPasswordResetRequested(t *testing.T) {
	t.Setenv(AdminPasswordResetEnv, "")
	if adminPasswordResetRequested() {
		t.Fatal("an unset value requested a password reset")
	}
	for _, value := range []string{"1", "true", "TRUE", "yes", "Yes", " 1 "} {
		t.Setenv(AdminPasswordResetEnv, value)
		if !adminPasswordResetRequested() {
			t.Fatalf("%q did not request a password reset", value)
		}
	}
	for _, value := range []string{"0", "false", "no", "maybe", ""} {
		t.Setenv(AdminPasswordResetEnv, value)
		if adminPasswordResetRequested() {
			t.Fatalf("%q requested a password reset", value)
		}
	}
}
