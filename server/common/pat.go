package common

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
)

// PATPrefix identifies personal access tokens presented in the
// Authorization header.
const PATPrefix = "obk_"

const patRandomBytes = 32

// GeneratePAT creates a new personal access token. It returns the raw
// token (to show to the user exactly once), the sha256 hash to persist,
// and a short display prefix.
func GeneratePAT() (raw string, hash string, prefix string, err error) {
	buf := make([]byte, patRandomBytes)
	if _, err = rand.Read(buf); err != nil {
		return "", "", "", err
	}
	raw = PATPrefix + base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(raw))
	hash = hex.EncodeToString(sum[:])
	prefix = raw[:len(PATPrefix)+8]
	return raw, hash, prefix, nil
}

// HashPAT hashes a presented raw token for lookup.
func HashPAT(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// IsPAT reports whether an Authorization header value is a personal
// access token (as opposed to a login JWT or the admin site token). The
// "Bearer " scheme is accepted because that is how OAuth-style clients —
// MCP servers, ChatGPT plugins, most HTTP libraries — send any credential.
func IsPAT(token string) bool {
	return strings.HasPrefix(Credential(token), PATPrefix)
}

// patLastUsedThrottle controls how often a token's last-used time is
// persisted to the database.
const patLastUsedThrottle = 5 * time.Minute

// ResolvePAT authenticates a personal access token and returns its owner
// and the token record (with granted scopes). The credential is normalized
// before hashing, so a client that sends the "Bearer " scheme resolves to the
// same row as one that sends the bare token — the digest stored at creation is
// of the bare secret.
func ResolvePAT(raw string) (*model.User, *model.AccessToken, error) {
	t, err := op.GetAccessTokenByHash(HashPAT(Credential(raw)))
	if err != nil {
		return nil, nil, err
	}
	user, err := op.GetUserById(t.UserId)
	if err != nil {
		return nil, nil, err
	}
	if user.Disabled {
		return nil, nil, errors.New("token owner is disabled")
	}
	if err := op.TouchAccessTokenLastUsed(t, patLastUsedThrottle); err != nil {
		// last-used tracking is best-effort; never fail auth on it
		log.Warnf("failed to update access token last used time: %v", err)
	}
	return user, t, nil
}
