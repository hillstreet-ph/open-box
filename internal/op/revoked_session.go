package op

import (
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/pkg/errors"
)

// RevokeSession records that the login session whose hash is tokenHash signed
// out. The record survives a restart so logging out cannot be undone by a
// redeploy.
func RevokeSession(tokenHash string, expiresAt time.Time) error {
	return errors.WithStack(db.RevokeSession(tokenHash, expiresAt))
}

// ListUnexpiredRevokedSessions returns revocations that still matter.
func ListUnexpiredRevokedSessions(now time.Time) ([]model.RevokedSession, error) {
	rows, err := db.ListUnexpiredRevokedSessions(now)
	if err != nil {
		return nil, errors.WithStack(err)
	}
	return rows, nil
}

// PruneExpiredRevokedSessions drops revocations for tokens that expired.
func PruneExpiredRevokedSessions(now time.Time) error {
	return errors.WithStack(db.DeleteExpiredRevokedSessions(now))
}
