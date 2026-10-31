package db

import (
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/pkg/errors"
	"gorm.io/gorm/clause"
)

var errDatabaseNotInitialized = errors.New("database is not initialized")

// RevokeSession stores the hash of a signed-out session token. Revoking the
// same session again is not an error.
func RevokeSession(tokenHash string, expiresAt time.Time) error {
	if db == nil {
		return errDatabaseNotInitialized
	}
	row := model.RevokedSession{TokenHash: tokenHash, ExpiresAt: expiresAt}
	return errors.WithStack(db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "token_hash"}},
		DoNothing: true,
	}).Create(&row).Error)
}

// ListUnexpiredRevokedSessions returns revocations whose token has not expired
// on its own yet, so callers can keep them in memory.
func ListUnexpiredRevokedSessions(now time.Time) ([]model.RevokedSession, error) {
	if db == nil {
		return nil, errDatabaseNotInitialized
	}
	var rows []model.RevokedSession
	if err := db.Where("expires_at > ?", now).Find(&rows).Error; err != nil {
		return nil, errors.WithStack(err)
	}
	return rows, nil
}

// DeleteExpiredRevokedSessions removes revocations for tokens that already
// expired, keeping the table bounded without a scheduled job.
func DeleteExpiredRevokedSessions(now time.Time) error {
	if db == nil {
		return errDatabaseNotInitialized
	}
	return errors.WithStack(db.Where("expires_at <= ?", now).Delete(&model.RevokedSession{}).Error)
}
