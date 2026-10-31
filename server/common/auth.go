package common

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils/random"
	"github.com/golang-jwt/jwt/v4"
	"github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
)

// SecretKey signs login sessions. UseDurableJwtSecret keeps it in step with
// the value stored in the settings table.
//
// A login session is a signed JWT, so verifying it needs no database round
// trip. Two things make it survive a restart or a redeploy:
//
//  1. the signing key comes from the settings table (see JwtSecret) instead of
//     a value regenerated on every boot;
//  2. signing out is recorded as a revocation (see revocationStore) instead of
//     keeping every issued token in process memory.
//
// The previous implementation cached the tokens it had issued in memory and
// treated a cache miss as a revocation, so every container restart answered
// "token is invalidated" for all logged-in users.
var SecretKey []byte

type UserClaims struct {
	Username string `json:"username"`
	PwdTS    int64  `json:"pwd_ts"`
	jwt.RegisteredClaims
}

const (
	// sessionRevocationReload bounds how often the in-process mirror of the
	// revoked session table is refreshed.
	sessionRevocationReload = 10 * time.Second
	// sessionRevocationPrune bounds how often expired rows are deleted.
	sessionRevocationPrune = time.Hour
	// defaultSessionLifetime is used only when neither the configuration nor
	// the token itself states an expiry.
	defaultSessionLifetime = 48 * time.Hour
)

var generatedSecret struct {
	once  sync.Once
	value string
}

// JwtSecret returns the key that signs login sessions.
// The settings table holds the durable value: it is seeded on the first boot
// from OPENLIST_JWT_SECRET or config.json, and later boots keep the stored
// value even when the configuration file lives on an ephemeral filesystem and
// was regenerated with a different random secret.
func JwtSecret() string {
	if stored := setting.GetStr(conf.JwtSecretKey); stored != "" {
		return stored
	}
	if conf.Conf != nil && conf.Conf.JwtSecret != "" {
		return conf.Conf.JwtSecret
	}
	generatedSecret.once.Do(func() {
		generatedSecret.value = random.String(32)
		log.Warn("no jwt secret in the database or the configuration; using an ephemeral signing key, sessions will not survive a restart. Set OPENLIST_JWT_SECRET or give the data directory a persistent volume")
	})
	return generatedSecret.value
}

// UseDurableJwtSecret signs sessions with the durable secret and keeps it in
// step with the settings table, so an administrator who rotates the key logs
// every session out immediately instead of at the next restart.
func UseDurableJwtSecret() {
	SecretKey = []byte(JwtSecret())
	op.RegisterSettingChangingCallback(func() {
		SecretKey = []byte(JwtSecret())
	})
}

// revocationStore mirrors the revoked session table in memory. The table only
// holds sessions that were signed out before their own expiry, which is a small
// set, so one cheap query per refresh interval replaces a database lookup on
// every authenticated request. A process sees another instance's logout within
// one refresh interval; its own logouts apply immediately.
type revocationStore struct {
	mu          sync.Mutex
	hashes      map[string]time.Time
	loadedAt    time.Time
	lastPrune   time.Time
	reloadEvery time.Duration
	pruneEvery  time.Duration
	failures    int
	list        func(time.Time) ([]model.RevokedSession, error)
}

func newRevocationStore() *revocationStore {
	return &revocationStore{
		hashes:      make(map[string]time.Time),
		reloadEvery: sessionRevocationReload,
		pruneEvery:  sessionRevocationPrune,
		list:        op.ListUnexpiredRevokedSessions,
	}
}

var revokedSessions = newRevocationStore()

// contains reports whether the session with the given hash was signed out and
// has not expired on its own yet.
func (r *revocationStore) contains(hash string) bool {
	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	if now.Sub(r.loadedAt) >= r.reloadEvery {
		r.reloadLocked(now)
	}
	expiresAt, ok := r.hashes[hash]
	return ok && expiresAt.After(now)
}

// add makes a revocation effective in this process right away.
func (r *revocationStore) add(hash string, expiresAt time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.hashes[hash] = expiresAt
	// the row is written by the caller; delaying the next reload keeps this
	// entry visible even if the write lands after a concurrent refresh
	r.loadedAt = time.Now()
}

func (r *revocationStore) reloadLocked(now time.Time) {
	items, err := r.list(now)
	if err != nil {
		r.failures++
		if r.failures == 1 {
			log.Warnf("failed to load revoked sessions, keeping the current view: %+v", err)
		} else {
			log.Debugf("revoked sessions still unavailable: %+v", err)
		}
	} else {
		r.failures = 0
		r.hashes = make(map[string]time.Time, len(items))
		for _, item := range items {
			if item.ExpiresAt.After(now) {
				r.hashes[item.TokenHash] = item.ExpiresAt
			}
		}
	}
	r.loadedAt = now
	if now.Sub(r.lastPrune) >= r.pruneEvery {
		r.lastPrune = now
		if err := op.PruneExpiredRevokedSessions(now); err != nil {
			log.Warnf("failed to prune expired sessions: %+v", err)
		}
	}
}

func GenerateToken(user *model.User) (tokenString string, err error) {
	claim := UserClaims{
		Username: user.Username,
		PwdTS:    user.PwdTS,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(conf.Conf.TokenExpiresIn) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claim)
	tokenString, err = token.SignedString(SecretKey)
	if err != nil {
		return "", err
	}
	return tokenString, err
}

func ParseToken(tokenString string) (*UserClaims, error) {
	claims, err := verifySessionToken(tokenString)
	if err != nil {
		return nil, err
	}
	if IsTokenInvalidated(tokenString) {
		return nil, errors.New("token is invalidated")
	}
	return claims, nil
}

func verifySessionToken(tokenString string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &UserClaims{}, func(token *jwt.Token) (interface{}, error) {
		return SecretKey, nil
	})
	if err != nil {
		if ve, ok := err.(*jwt.ValidationError); ok {
			if ve.Errors&jwt.ValidationErrorMalformed != 0 {
				return nil, errors.New("that's not even a token")
			} else if ve.Errors&jwt.ValidationErrorExpired != 0 {
				return nil, errors.New("token is expired")
			} else if ve.Errors&jwt.ValidationErrorNotValidYet != 0 {
				return nil, errors.New("token not active yet")
			} else {
				return nil, errors.New("couldn't handle this token")
			}
		}
		return nil, errors.New("couldn't handle this token")
	}
	if claims, ok := token.Claims.(*UserClaims); ok && token.Valid {
		return claims, nil
	}
	return nil, errors.New("couldn't handle this token")
}

// InvalidateToken signs a session out. The revocation is persisted, so a
// redeploy cannot hand a signed-out token back to its holder.
func InvalidateToken(tokenString string) error {
	if tokenString == "" {
		return nil // don't invalidate empty guest token
	}
	expiresAt := sessionExpiry(tokenString)
	hash := hashSessionToken(tokenString)
	revokedSessions.add(hash, expiresAt)
	return op.RevokeSession(hash, expiresAt)
}

func IsTokenInvalidated(tokenString string) bool {
	if tokenString == "" {
		return false
	}
	return revokedSessions.contains(hashSessionToken(tokenString))
}

// hashSessionToken identifies a session without storing the token itself.
func hashSessionToken(tokenString string) string {
	sum := sha256.Sum256([]byte(strings.TrimPrefix(tokenString, "Bearer ")))
	return hex.EncodeToString(sum[:])
}

// sessionExpiry reads the expiry the token was issued with without trusting
// its signature; the revocation only needs to live as long as the token does.
func sessionExpiry(tokenString string) time.Time {
	claims := &UserClaims{}
	if _, _, err := jwt.NewParser().ParseUnverified(tokenString, claims); err == nil && claims.ExpiresAt != nil {
		return claims.ExpiresAt.Time
	}
	if conf.Conf != nil {
		return time.Now().Add(time.Duration(conf.Conf.TokenExpiresIn) * time.Hour)
	}
	return time.Now().Add(defaultSessionLifetime)
}
