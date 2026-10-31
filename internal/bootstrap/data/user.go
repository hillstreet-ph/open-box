package data

import (
	"fmt"
	"os"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils/random"
	"github.com/pkg/errors"
	"gorm.io/gorm"
)

// AdminPasswordResetEnv opts an existing installation in to applying
// OPENLIST_ADMIN_PASSWORD to the administrator account it already has.
const AdminPasswordResetEnv = "OPENLIST_ADMIN_PASSWORD_RESET"

func initUser() {
	admin, err := op.GetAdmin()
	adminPassword := random.String(8)
	envpass := os.Getenv("OPENLIST_ADMIN_PASSWORD")
	if flags.Dev {
		adminPassword = "admin"
	} else if len(envpass) > 0 {
		adminPassword = envpass
	}
	created := false
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			created = true
			salt := random.String(16)
			admin = &model.User{
				Username: "admin",
				Salt:     salt,
				PwdHash:  model.TwoHashPwd(adminPassword, salt),
				Role:     model.ADMIN,
				BasePath: "/",
				Authn:    "[]",
				// 0(can see hidden) - 8(webdav read) & 12(can read archives) - 14(can share)
				Permission: 0x71FF,
			}
			if err := op.CreateUser(admin); err != nil {
				panic(err)
			} else {
				// DO NOT output the password to log file. Only output to console.
				// utils.Log.Infof("Successfully created the admin user and the initial password is: %s", adminPassword)
				fmt.Printf("Successfully created the admin user and the initial password is: %s\n", adminPassword)
			}
		} else {
			utils.Log.Fatalf("[init user] Failed to get admin user: %v", err)
		}
	}
	if !created && !flags.Dev {
		reportInitialPassword(admin, envpass)
	}
	_, err = op.GetGuest()
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			salt := random.String(16)
			guest := &model.User{
				Username:   "guest",
				PwdHash:    model.TwoHashPwd("guest", salt),
				Salt:       salt,
				Role:       model.GUEST,
				BasePath:   "/",
				Permission: 0,
				Disabled:   true,
				Authn:      "[]",
			}
			if err := db.CreateUser(guest); err != nil {
				utils.Log.Fatalf("[init user] Failed to create guest user: %v", err)
			}
		} else {
			utils.Log.Fatalf("[init user] Failed to get guest user: %v", err)
		}
	}
}

// reportInitialPassword makes the initial-password environment variable account
// for itself on an existing installation.
//
// OPENLIST_ADMIN_PASSWORD is only consumed while the administrator row is being
// created, so rotating it afterwards changes nothing and the operator is left
// with a password that the service rejects without explanation. Never overwrite
// a live account on its own: say what happened, and require an explicit opt-in
// to apply the value.
func reportInitialPassword(admin *model.User, envpass string) {
	switch decideInitialPassword(admin, envpass, adminPasswordResetRequested()) {
	case initialPasswordUnchanged:
		return
	case initialPasswordIgnored:
		// Console only, like the initial password: the account name is the most
		// this may say.
		fmt.Printf("OPENLIST_ADMIN_PASSWORD does not match the existing administrator %q and was ignored; "+
			"sign in with the current password, or set %s=1 to apply the environment value to this account.\n",
			admin.Username, AdminPasswordResetEnv)
		return
	case initialPasswordReset:
		admin.SetPassword(envpass)
		if err := op.UpdateUser(admin); err != nil {
			utils.Log.Fatalf("[init user] Failed to apply %s: %v", AdminPasswordResetEnv, err)
		}
		fmt.Printf("The password of administrator %q was reset from OPENLIST_ADMIN_PASSWORD; "+
			"remove %s and OPENLIST_ADMIN_PASSWORD now that it has been applied.\n",
			admin.Username, AdminPasswordResetEnv)
	}
}

// initialPasswordDecision is what boot makes of OPENLIST_ADMIN_PASSWORD when the
// administrator already exists.
type initialPasswordDecision int

const (
	// nothing to do: no value, no account, or the value already matches
	initialPasswordUnchanged initialPasswordDecision = iota
	// the value does not match and applying it was not requested
	initialPasswordIgnored
	// the value does not match and the operator asked for it to be applied
	initialPasswordReset
)

func decideInitialPassword(admin *model.User, envpass string, resetRequested bool) initialPasswordDecision {
	if admin == nil || len(envpass) == 0 || admin.ValidateRawPassword(envpass) == nil {
		return initialPasswordUnchanged
	}
	if !resetRequested {
		return initialPasswordIgnored
	}
	return initialPasswordReset
}

func adminPasswordResetRequested() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(AdminPasswordResetEnv))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}
