package model

import (
	"strings"
	"time"
)

// Personal access token scopes. A PAT may carry any subset of these;
// session (JWT) authentication is unaffected and keeps role-based permissions.
const (
	ScopeFSRead    = "fs:read"
	ScopeFSWrite   = "fs:write"
	ScopeShare     = "share:read"
	ScopeTaskRead  = "task:read"
	ScopeTaskWrite = "task:write"
)

// ValidScopes lists every scope a personal access token may be granted.
var ValidScopes = []string{ScopeFSRead, ScopeFSWrite, ScopeShare, ScopeTaskRead, ScopeTaskWrite}

// AccessToken is a user-issued personal access token (PAT).
// The raw token is shown exactly once at creation; only its sha256
// hash is persisted.
type AccessToken struct {
	ID           uint       `json:"id" gorm:"primaryKey"`
	UserId       uint       `json:"-"`
	Name         string     `json:"name"`
	Prefix       string     `json:"prefix"` // display-only prefix, e.g. "obk_a1b2c3d4"
	TokenHash    string     `json:"-" gorm:"uniqueIndex"`
	Scopes       string     `json:"scopes"` // comma-separated scopes
	ExpiresAt    *time.Time `json:"expires_at"`
	LastUsedTime time.Time  `json:"last_used_time"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"-"`
	RevokedAt    *time.Time `json:"revoked_at"`
}

// ScopeList returns the granted scopes as a slice.
func (t *AccessToken) ScopeList() []string {
	if t.Scopes == "" {
		return nil
	}
	parts := strings.Split(t.Scopes, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// HasScope reports whether the token was granted the given scope.
func (t *AccessToken) HasScope(scope string) bool {
	for _, s := range t.ScopeList() {
		if s == scope {
			return true
		}
	}
	return false
}

// IsActive reports whether the token can still authenticate requests.
func (t *AccessToken) IsActive() bool {
	if t.RevokedAt != nil {
		return false
	}
	if t.ExpiresAt != nil && time.Now().After(*t.ExpiresAt) {
		return false
	}
	return true
}

// ValidateScopes returns the scopes that are not in ValidScopes.
func ValidateScopes(scopes []string) []string {
	valid := make(map[string]struct{}, len(ValidScopes))
	for _, s := range ValidScopes {
		valid[s] = struct{}{}
	}
	var invalid []string
	for _, s := range scopes {
		if _, ok := valid[s]; !ok {
			invalid = append(invalid, s)
		}
	}
	return invalid
}
