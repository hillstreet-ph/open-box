package op

import (
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/pkg/errors"
)

// CreateAccessToken persists a new personal access token. The raw token
// is never stored; the caller is responsible for showing it once.
func CreateAccessToken(t *model.AccessToken) error {
	_, err := db.GetAccessTokenByHash(t.TokenHash)
	if err == nil {
		return errors.New("access token collision, please retry")
	}
	now := time.Now()
	t.CreatedAt = now
	t.UpdatedAt = now
	t.LastUsedTime = now
	return db.CreateAccessToken(t)
}

// GetAccessTokenByHash resolves a token hash to its record, rejecting
// revoked or expired tokens.
func GetAccessTokenByHash(hash string) (*model.AccessToken, error) {
	t, err := db.GetAccessTokenByHash(hash)
	if err != nil {
		return nil, err
	}
	if !t.IsActive() {
		return nil, errors.New("access token is revoked or expired")
	}
	return t, nil
}

// GetAccessTokenByIdAndUserId scopes a token lookup to its owner.
func GetAccessTokenByIdAndUserId(id uint, userId uint) (*model.AccessToken, error) {
	return db.GetAccessTokenByIdAndUserId(id, userId)
}

func GetAccessTokensByUserId(userId uint, pageIndex, pageSize int) (tokens []model.AccessToken, count int64, err error) {
	return db.GetAccessTokensByUserId(userId, pageIndex, pageSize)
}

// TouchAccessTokenLastUsed refreshes last-used time at most once per
// throttle window to avoid a database write on every request.
func TouchAccessTokenLastUsed(t *model.AccessToken, throttle time.Duration) error {
	if time.Since(t.LastUsedTime) < throttle {
		return nil
	}
	t.LastUsedTime = time.Now()
	return db.UpdateAccessTokenLastUsed(t.ID, t.LastUsedTime)
}

// RevokeAccessToken marks a token as revoked. The record is kept for audit.
func RevokeAccessToken(t *model.AccessToken) error {
	now := time.Now()
	t.RevokedAt = &now
	return db.UpdateAccessTokenRevoked(t.ID, now)
}
