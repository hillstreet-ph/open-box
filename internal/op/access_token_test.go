package op_test

import (
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/server/common"
)

func TestAccessTokenLifecycle(t *testing.T) {
	user := &model.User{Username: "pat-user", Role: model.GENERAL}
	if err := op.CreateUser(user); err != nil {
		t.Fatalf("failed to create user: %+v", err)
	}

	raw, hash, prefix, err := common.GeneratePAT()
	if err != nil {
		t.Fatalf("failed to generate pat: %+v", err)
	}
	if !common.IsPAT(raw) {
		t.Fatalf("generated token missing pat prefix: %q", prefix)
	}
	if common.HashPAT(raw) != hash {
		t.Fatal("HashPAT does not match the hash returned by GeneratePAT")
	}

	token := &model.AccessToken{
		UserId:    user.ID,
		Name:      "test-agent",
		Prefix:    prefix,
		TokenHash: hash,
		Scopes:    model.ScopeFSRead,
	}
	if err := op.CreateAccessToken(token); err != nil {
		t.Fatalf("failed to create access token: %+v", err)
	}

	resolved, err := op.GetAccessTokenByHash(hash)
	if err != nil {
		t.Fatalf("failed to resolve access token: %+v", err)
	}
	if !resolved.HasScope(model.ScopeFSRead) {
		t.Fatal("expected fs:read scope to be present")
	}
	if resolved.HasScope(model.ScopeFSWrite) {
		t.Fatal("did not expect fs:write scope to be present")
	}

	// duplicate hash must be rejected
	dupe := &model.AccessToken{UserId: user.ID, Name: "dupe", Prefix: prefix, TokenHash: hash, Scopes: model.ScopeFSRead}
	if err := op.CreateAccessToken(dupe); err == nil {
		t.Fatal("expected duplicate token hash to be rejected")
	}

	// owner scoping
	if _, err := op.GetAccessTokenByIdAndUserId(token.ID, user.ID+999); err == nil {
		t.Fatal("expected token lookup for another user to fail")
	}

	// revoke
	if err := op.RevokeAccessToken(resolved); err != nil {
		t.Fatalf("failed to revoke: %+v", err)
	}
	if _, err := op.GetAccessTokenByHash(hash); err == nil {
		t.Fatal("expected revoked token to fail resolution")
	}
}

func TestAccessTokenExpiry(t *testing.T) {
	user := &model.User{Username: "pat-expiry", Role: model.GENERAL}
	if err := op.CreateUser(user); err != nil {
		t.Fatalf("failed to create user: %+v", err)
	}
	_, hash, prefix, err := common.GeneratePAT()
	if err != nil {
		t.Fatalf("failed to generate pat: %+v", err)
	}
	expiresAt := time.Now().Add(-time.Hour)
	token := &model.AccessToken{
		UserId:    user.ID,
		Name:      "expired",
		Prefix:    prefix,
		TokenHash: hash,
		Scopes:    model.ScopeFSRead,
		ExpiresAt: &expiresAt,
	}
	if err := op.CreateAccessToken(token); err != nil {
		t.Fatalf("failed to create access token: %+v", err)
	}
	if _, err := op.GetAccessTokenByHash(hash); err == nil {
		t.Fatal("expected expired token to fail resolution")
	}
}

func TestTouchAccessTokenThrottled(t *testing.T) {
	user := &model.User{Username: "pat-touch", Role: model.GENERAL}
	if err := op.CreateUser(user); err != nil {
		t.Fatalf("failed to create user: %+v", err)
	}
	_, hash, prefix, err := common.GeneratePAT()
	if err != nil {
		t.Fatalf("failed to generate pat: %+v", err)
	}
	token := &model.AccessToken{
		UserId:    user.ID,
		Name:      "touch",
		Prefix:    prefix,
		TokenHash: hash,
		Scopes:    model.ScopeFSRead,
	}
	if err := op.CreateAccessToken(token); err != nil {
		t.Fatalf("failed to create access token: %+v", err)
	}
	// immediately after creation the throttle window suppresses the update
	before := token.LastUsedTime
	if err := op.TouchAccessTokenLastUsed(token, 5*time.Minute); err != nil {
		t.Fatalf("touch failed: %+v", err)
	}
	if !token.LastUsedTime.Equal(before) {
		t.Fatal("expected last-used update to be throttled")
	}
}

func TestValidateScopes(t *testing.T) {
	if invalid := model.ValidateScopes([]string{model.ScopeFSRead, "bogus:scope"}); len(invalid) != 1 || invalid[0] != "bogus:scope" {
		t.Fatalf("expected only bogus:scope to be rejected, got %v", invalid)
	}
	if invalid := model.ValidateScopes(model.ValidScopes); len(invalid) != 0 {
		t.Fatalf("expected all valid scopes to pass, got %v", invalid)
	}
}
