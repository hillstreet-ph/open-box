package common

import (
	"errors"
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

const testSessionSecret = "unit-test-session-secret"

func init() {
	conf.Conf = conf.DefaultConfig("data")
	conf.Conf.JwtSecret = testSessionSecret
	dB, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		panic("failed to connect database")
	}
	db.Init(dB)
	SecretKey = []byte(testSessionSecret)
}

func sessionUser(name string) *model.User {
	return &model.User{Username: name, Role: model.GENERAL, PwdTS: time.Now().Unix()}
}

func mustToken(t *testing.T, name string) string {
	t.Helper()
	raw, err := GenerateToken(sessionUser(name))
	if err != nil {
		t.Fatalf("failed to generate session token: %+v", err)
	}
	return raw
}

// A redeploy or restart must not log active users out: the previous
// implementation kept an in-process allow-list of issued tokens, so every
// session was reported as invalidated after a restart.
func TestSessionTokenSurvivesRestart(t *testing.T) {
	revokedSessions = newRevocationStore()
	raw := mustToken(t, "restart-survivor")
	claims, err := ParseToken(raw)
	if err != nil {
		t.Fatalf("freshly issued token rejected: %+v", err)
	}
	if claims.Username != "restart-survivor" {
		t.Fatalf("unexpected claims username %q", claims.Username)
	}

	// a new process starts with an empty in-memory view of revocations
	revokedSessions = newRevocationStore()
	if IsTokenInvalidated(raw) {
		t.Fatal("live session was invalidated by a restart")
	}
	if _, err := ParseToken(raw); err != nil {
		t.Fatalf("live session rejected after a restart: %+v", err)
	}
}

// Logout must keep working when revocations no longer live in process memory.
func TestLogoutRevocationSurvivesRestart(t *testing.T) {
	revokedSessions = newRevocationStore()
	raw := mustToken(t, "logged-out")

	if err := InvalidateToken(raw); err != nil {
		t.Fatalf("logout failed: %+v", err)
	}
	if !IsTokenInvalidated(raw) {
		t.Fatal("logout did not revoke the session")
	}
	if _, err := ParseToken(raw); err == nil {
		t.Fatal("revoked session still authenticates")
	}

	revokedSessions = newRevocationStore()
	if !IsTokenInvalidated(raw) {
		t.Fatal("revocation was lost with the process")
	}
	if _, err := ParseToken(raw); err == nil {
		t.Fatal("revoked session authenticates again after a restart")
	}
}

func TestRevokingTheSameSessionTwiceSucceeds(t *testing.T) {
	revokedSessions = newRevocationStore()
	raw := mustToken(t, "double-logout")
	if err := InvalidateToken(raw); err != nil {
		t.Fatalf("first logout failed: %+v", err)
	}
	if err := InvalidateToken(raw); err != nil {
		t.Fatalf("second logout failed: %+v", err)
	}
	if !IsTokenInvalidated(raw) {
		t.Fatal("session is not revoked")
	}
}

func TestEmptyTokenIsNeverRevoked(t *testing.T) {
	if err := InvalidateToken(""); err != nil {
		t.Fatalf("revoking the guest token returned an error: %+v", err)
	}
	if IsTokenInvalidated("") {
		t.Fatal("the guest token is reported as revoked")
	}
}

func TestParseTokenRejectsBadTokens(t *testing.T) {
	if _, err := ParseToken("not-even-a-token"); err == nil {
		t.Fatal("malformed token accepted")
	}

	expiresIn := conf.Conf.TokenExpiresIn
	conf.Conf.TokenExpiresIn = -1
	expired := mustToken(t, "expired-session")
	conf.Conf.TokenExpiresIn = expiresIn
	if _, err := ParseToken(expired); err == nil {
		t.Fatal("expired token accepted")
	}

	revokedSessions = newRevocationStore()
	other := []byte(SecretKey)
	SecretKey = []byte("a-different-secret")
	foreign := mustToken(t, "foreign-session")
	SecretKey = other
	if _, err := ParseToken(foreign); err == nil {
		t.Fatal("token signed with another secret accepted")
	}
}

func TestRevokedSessionRowsArePrunedAfterExpiry(t *testing.T) {
	now := time.Now()
	if err := op.RevokeSession("already-expired-hash", now.Add(-time.Hour)); err != nil {
		t.Fatalf("failed to store an expired revocation: %+v", err)
	}
	if err := op.RevokeSession("live-hash", now.Add(time.Hour)); err != nil {
		t.Fatalf("failed to store a live revocation: %+v", err)
	}
	items, err := op.ListUnexpiredRevokedSessions(now)
	if err != nil {
		t.Fatalf("failed to list revocations: %+v", err)
	}
	var sawLive, sawExpired bool
	for _, item := range items {
		switch item.TokenHash {
		case "live-hash":
			sawLive = true
		case "already-expired-hash":
			sawExpired = true
		}
	}
	if !sawLive {
		t.Fatal("the live revocation was not listed")
	}
	if sawExpired {
		t.Fatal("an expired revocation was still listed")
	}
	if err := op.PruneExpiredRevokedSessions(now); err != nil {
		t.Fatalf("failed to prune expired revocations: %+v", err)
	}
	remaining, err := op.ListUnexpiredRevokedSessions(now.Add(2 * time.Hour))
	if err != nil {
		t.Fatalf("failed to list revocations after pruning: %+v", err)
	}
	for _, item := range remaining {
		if item.TokenHash == "already-expired-hash" {
			t.Fatal("expired revocation survived pruning")
		}
	}
}

// The revocation mirror must degrade to the in-process view instead of
// dropping every session when the database is briefly unreachable.
func TestRevocationStoreKeepsItsViewWhenTheDatabaseFails(t *testing.T) {
	store := newRevocationStore()
	store.hashes["cached-hash"] = time.Now().Add(time.Hour)
	store.loadedAt = time.Now().Add(-2 * store.reloadEvery)
	store.list = func(time.Time) ([]model.RevokedSession, error) {
		return nil, errors.New("database is unreachable")
	}
	if !store.contains("cached-hash") {
		t.Fatal("the cached revocation was dropped when the reload failed")
	}
	// and a reload that succeeds replaces the view
	store.list = func(time.Time) ([]model.RevokedSession, error) {
		return []model.RevokedSession{{TokenHash: "from-db", ExpiresAt: time.Now().Add(time.Hour)}}, nil
	}
	store.loadedAt = time.Now().Add(-2 * store.reloadEvery)
	if !store.contains("from-db") {
		t.Fatal("the revocation loaded from the database is missing")
	}
	if store.contains("cached-hash") {
		t.Fatal("a stale in-process revocation survived a successful reload")
	}
}

func TestJwtSecretPrefersTheDurableSetting(t *testing.T) {
	if got := JwtSecret(); got != testSessionSecret {
		t.Fatalf("without a stored setting the config secret should be used, got %q", got)
	}
	item := &model.SettingItem{
		Key:   conf.JwtSecretKey,
		Value: "durable-secret",
		Type:  conf.TypeString,
		Group: model.SINGLE,
		Flag:  model.PRIVATE,
	}
	if err := op.SaveSettingItem(item); err != nil {
		t.Fatalf("failed to store the jwt secret setting: %+v", err)
	}
	if got := JwtSecret(); got != "durable-secret" {
		t.Fatalf("expected the stored secret to win, got %q", got)
	}

	// an empty stored value must never disable signing
	empty := *item
	empty.Value = ""
	if err := op.SaveSettingItem(&empty); err != nil {
		t.Fatalf("failed to store an empty jwt secret setting: %+v", err)
	}
	conf.Conf.JwtSecret = "config-secret"
	if got := JwtSecret(); got != "config-secret" {
		t.Fatalf("expected the config secret as fallback, got %q", got)
	}

	conf.Conf.JwtSecret = ""
	generated := JwtSecret()
	if len(generated) < 32 {
		t.Fatalf("a missing secret everywhere must generate a strong one, got %q", generated)
	}
	if generated == "" {
		t.Fatal("empty signing secret")
	}

	// and it stays stable for the lifetime of the process
	if second := JwtSecret(); second != generated {
		t.Fatalf("the generated secret changed between calls: %q != %q", second, generated)
	}

	conf.Conf.JwtSecret = testSessionSecret
	if err := db.DeleteSettingItemByKey(conf.JwtSecretKey); err != nil {
		t.Fatalf("failed to clean up the jwt secret setting: %+v", err)
	}
}
