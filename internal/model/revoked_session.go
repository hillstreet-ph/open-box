package model

import "time"

// RevokedSession records a login session that was signed out before its own
// expiry. Only the sha256 hash of the session JWT is stored, never the token.
// A row becomes useless once the token it refers to has expired by itself and
// can then be pruned.
type RevokedSession struct {
	ID        uint      `json:"-" gorm:"primaryKey"`
	TokenHash string    `json:"-" gorm:"uniqueIndex;size:64"`
	ExpiresAt time.Time `json:"expires_at" gorm:"index"`
	CreatedAt time.Time `json:"created_at"`
}
