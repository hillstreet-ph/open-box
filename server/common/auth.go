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

// signingKey signs login sessions. UseDurableJwtSecret keeps it in step with
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
//
// An administrator rotating the jwt_secret setting replaces the key while
// requests are in flight, so the value is read through an accessor instead of
// touched as a plain global.
var (
	signingKeyMu sync.RWMutex
	signingKey   []byte
)

// SigningKey returns the key that signs and verifies login sessions.
func SigningKey() []byte {
	signingKeyMu.RLock()
	defer signingKeyMu.RUnlock()
	return signingKey
}

// SetSigningKey installs the session signing key. The bytes are never mutated
// in place, only replaced, so a key returned by SigningKey stays usable for as
// long as its holder needs it.
func SetSigningKey(key []byte) {
	signingKeyMu.Lock()
	defer signingKeyMu.Unlock()
	signingKey = key
}

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
//
// This reads the settings cache, so it belongs to startup and key rotation.
// Request handlers use SigningKey, which the setting-changing callback keeps
// in step; nothing on the hot path calls JwtSecret.
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
	SetSigningKey([]byte(JwtSecret()))
	op.RegisterSettingChangingCallback(func() {
		SetSigningKey([]byte(JwtSecret()))
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
	tokenString, err = token.SignedString(SigningKey())
	if err != nil {
		return "", err
	}
	return tokenString, err
}

func ParseToken(tokenString string) (*UserClaims, error) {
	// Normalized so a caller that was handed the Authorization header verbatim
	// resolves the same session as one that was handed the bare token.
	// Credential is idempotent, so passing an already-normalized token is a
	// no-op.
	credential := Credential(tokenString)
	claims, err := verifySessionToken(credential)
	if err != nil {
		return nil, err
	}
	if IsTokenInvalidated(credential) {
		return nil, errors.New("token is invalidated")
	}
	return claims, nil
}

func verifySessionToken(tokenString string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &UserClaims{}, func(token *jwt.Token) (interface{}, error) {
		return SigningKey(), nil
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

// InvalidateToken signs a session out. The revocation is written to the
// database before it is applied in this process, so a failed durable write
// cannot leave a token that works again after a restart; the caller sees the
// error and the session stays usable instead of silently half-revoking.
func InvalidateToken(tokenString string) error {
	if tokenString == "" {
		return nil // don't invalidate empty guest token
	}
	hash := hashSessionToken(tokenString)
	expiresAt := sessionExpiry(tokenString)
	if err := op.RevokeSession(hash, expiresAt); err != nil {
		return err
	}
	revokedSessions.add(hash, expiresAt)
	return nil
}

func IsTokenInvalidated(tokenString string) bool {
	if tokenString == "" {
		return false
	}
	return revokedSessions.contains(hashSessionToken(tokenString))
}

// Credential returns the credential a request carries, in the one form every
// authentication path expects.
//
// Clients split into two camps. Browsers and the OpenList SDK put the token in
// the Authorization header by itself; OAuth-style clients — MCP servers,
// ChatGPT plugins, most HTTP libraries — put the "Bearer " scheme in front.
// Both mean the same credential, and a deployment that accepts only one of them
// reads as broken to the other half of its users: a "Bearer obk_…" access token
// used to fall through session parsing and answer "that's not even a token".
// So the scheme is removed once, here, instead of in each resolver.
//
// RFC 7235 makes the scheme case-insensitive and allows optional whitespace
// after it, and no session JWT, access token or site token can begin with the
// letters "bearer" followed by a space, so matching loosely costs nothing. A
// header without the scheme is returned trimmed but otherwise untouched, which
// keeps the empty header the guest signal it already is.
//
// Everything that reads a credential must go through this function — the site
// token comparison, the access-token prefix test, session parsing and the
// revocation hash alike. A path that instead compares or hashes exactly what
// arrived stores a revocation, or accepts a token, under a value no other path
// looks up.
func Credential(header string) string {
	trimmed := strings.TrimSpace(header)
	scheme, rest, hasScheme := strings.Cut(trimmed, " ")
	if hasScheme && strings.EqualFold(scheme, "Bearer") {
		return strings.TrimSpace(rest)
	}
	return trimmed
}

// sessionCredential is the canonical form of a session credential. Handlers
// hand over the raw Authorization header, and a client may send the bare token
// on one request and the "Bearer " form on the logout request, so both the
// revocation and the check normalize before hashing.
func sessionCredential(tokenString string) string {
	return Credential(tokenString)
}

// hashSessionToken identifies a session without storing the token itself.
func hashSessionToken(tokenString string) string {
	sum := sha256.Sum256([]byte(sessionCredential(tokenString)))
	return hex.EncodeToString(sum[:])
}

// sessionExpiry returns how long a revocation must be kept for this token: the
// expiry the token itself was signed with. The signature is verified to read
// it, because an unverified claim is attacker-chosen and would let a token
// holder decide how long a row lives; a token that fails verification is
// already rejected by ParseToken, so the configured lifetime is enough.
func sessionExpiry(tokenString string) time.Time {
	if claims, err := verifySessionToken(sessionCredential(tokenString)); err == nil && claims.ExpiresAt != nil {
		return claims.ExpiresAt.Time
	}
	if conf.Conf != nil && conf.Conf.TokenExpiresIn > 0 {
		return time.Now().Add(time.Duration(conf.Conf.TokenExpiresIn) * time.Hour)
	}
	return time.Now().Add(defaultSessionLifetime)
}
