package common

import (
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
)

// A personal access token is stored as the sha256 of the bare secret, but it is
// presented in whichever Authorization form the client speaks. Both must resolve
// to the same row: the digest looked up has to be the digest stored, and the
// prefix test has to recognize the token before session parsing gets a chance to
// call it malformed. This is the path MCP clients, ChatGPT plugins and the
// Composio toolkits take to reach the warehouse.
func TestAccessTokensResolveInBothAuthorizationForms(t *testing.T) {
	raw, hash, prefix, err := GeneratePAT()
	if err != nil {
		t.Fatalf("failed to generate an access token: %+v", err)
	}
	user := &model.User{
		Username: "pat-authorization-forms",
		Role:     model.GENERAL,
		PwdTS:    time.Now().Unix(),
	}
	if err := op.CreateUser(user); err != nil {
		t.Fatalf("failed to create the token owner: %+v", err)
	}
	defer func() {
		if err := op.DeleteUserById(user.ID); err != nil {
			t.Logf("failed to clean up the token owner: %+v", err)
		}
	}()
	token := &model.AccessToken{
		UserId:    user.ID,
		Name:      "authorization-forms",
		Prefix:    prefix,
		TokenHash: hash,
		Scopes:    "fs:read,fs:write",
	}
	if err := op.CreateAccessToken(token); err != nil {
		t.Fatalf("failed to store the access token: %+v", err)
	}

	for _, presented := range []string{raw, "Bearer " + raw, "bearer  " + raw} {
		if !IsPAT(presented) {
			t.Fatalf("IsPAT did not recognize the credential %q", presented)
		}
		resolvedUser, resolvedToken, err := ResolvePAT(presented)
		if err != nil {
			t.Fatalf("credential %q did not resolve: %+v", presented, err)
		}
		if resolvedUser.ID != user.ID {
			t.Fatalf("credential %q resolved to user %d, want %d", presented, resolvedUser.ID, user.ID)
		}
		if resolvedToken.ID != token.ID {
			t.Fatalf("credential %q resolved to token %d, want %d", presented, resolvedToken.ID, token.ID)
		}
		if got := resolvedToken.ScopeList(); len(got) != 2 || got[0] != "fs:read" || got[1] != "fs:write" {
			t.Fatalf("credential %q carried scopes %v", presented, got)
		}
	}

	// A credential in the right shape but unknown to the database is refused,
	// in either form, rather than falling through to session parsing.
	unknown := PATPrefix + "neverissued0000000000000000000000000000000000"
	for _, presented := range []string{unknown, "Bearer " + unknown} {
		if _, _, err := ResolvePAT(presented); err == nil {
			t.Fatalf("an unissued access token %q resolved", presented)
		}
	}
}
