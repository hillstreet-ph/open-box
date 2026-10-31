# Open-Box production status

Verified 2026-10-10. Public application: https://open-box.space.

## Verified deployment

| Component | Evidence |
| --- | --- |
| Cloudflare gateway | `open-box-gateway`, account `c0e6bd9a7249856cb8497e7fe340e7ce` |
| Current edge version | `c02b9dc1-0c96-4f7b-a59d-846eb12cdfca` |
| Current edge deployment | `5c3c6092-bd46-483a-96a4-611b3061d642`, 100% traffic |
| Zeabur | Project `6a966cc0a85370460248e847`, service `6a967b310e919aed614685ce`, running |
| Origin | https://open-box-space.zeabur.app |
| Runtime version | Backend commit `a879c97`, frontend v4.2.6; older than current repository |
| Supabase | `huadtiuuoiriqrjpjxhr`; `public.x_*` tables present |
| Storage mounts | Zero, confirmed through administrator API and database |

Branding version `173a3b01-c790-410f-8753-5b9ae800b9dc` passed exact-version root/admin/nested application HTML, About attribution, SVG manifest and cache checks. Current edge version adds reviewed OAuth consent and truthful readiness guidance; its exact preview and production checks passed for branding, action-required status, account mount paths, consent UI and invalid-request rejection. All 14 local edge tests and the Go MCP/static suites passed. The live browser confirms `Home | Open-Box` and `Powered by Open-Box`. Stored HTML/downloads/partial responses retain their original bytes. Upstream protocol identifiers and AGPL attribution remain intact.

The temporary Worker version URLs were disabled again after validation. Open-Box PRs #35, #38 and #39 were merged. The latest edge source is recorded in PR #38; this does not imply the older backend binary was upgraded.

## Promotion attempt: 2026-10-31, scoped personal access tokens

Verified against the live services on 2026-10-31 (UTC).

| Fact | Evidence |
| --- | --- |
| Merged backend source | `e73f3658` (merge of PR #58) on `main`; staging binary built from it passed the full PAT suite |
| CI images for `e73f3658` | Docker Hub `hillstreet/open-box:main-e73f365` and `:latest` at manifest `sha256:a465ba5b14e7d527e212949d67c0176b32ee2dfafd9f06841ea885823675f407`, pushed 09:19:14/09:19:16Z; a `workflow_dispatch` re-run pushed `:latest` `sha256:67abedf6533b2dbe0edb12ca7c9b01764eb51c875f0589616dd88f5e30e8aafb` at 10:53Z |
| Registry namespace | CI pushes to the Docker Hub account behind the `DOCKERHUB_USERNAME` secret, which is `hillstreet`. The repository variable `DOCKERHUB_ORG_NAME=openclose8` does not describe these artifacts; do not use it to identify them |
| Running production binary | `/api/public/settings` reports `Build at: 2026-10-31 08:50:39 +0000`, the build stamp of the `main-108c1cb` image (PR #59 docs, before the token merge). Superseded by the second-pass section below — the service rolled again at about 12:05Z |
| PAT behaviour probe | `POST /api/fs/list` with bearer `obk_*` returns `{"code":401,"message":"token is invalidated"}` at both the origin and `open-box.space`; the token-aware build returns `Invalid or expired access token`. `/api/me/token/list` still falls through to the SPA HTML |
| Auto-deploy | Neither the 09:19 nor the 10:53 `:latest` push rolled the service within an hour, so promotion needs an explicit Zeabur action |
| Frontend | `FRONTEND_REPO` now points at `hillstreet-ph/OpenList-Frontend`, whose first release `v4.2.9` publishes the `ce49abd` dist archive (Home and Profile moved into the `/manage` header). Earlier images used the upstream `OpenListTeam/OpenList-Frontend` release, so the merged header change was not in any built image before this |

Correction to the blocker above: the promotion path does exist inside CI. `ZEABUR_API_TOKEN` is present as a repository Actions secret and `ZEABUR_PROJECT_ID=6a966cc0a85370460248e847`, `ZEABUR_SERVICE_ID=6a967b310e919aed614685ce` are present as repository variables (they were read earlier from the wrong endpoint, `/repos/…/variables`, which 404s; the correct one is `/repos/…/actions/variables`). What is missing is not a credential path but the rotation attestation the workflow requires before it touches Zeabur.

## Promotion attempt: 2026-10-31 (second pass), artifact ready for the live gate

| Fact | Evidence |
| --- | --- |
| Promotion path is dispatchable | Run `41201462506` (`workflow_dispatch`, `rotate_confirmed = "no — stop"`) failed at the first step and reported every Zeabur step as *skipped*. The earlier "Actions disabled (422)" account gate no longer reproduces |
| Why the PAT image never reached Docker Hub | The push of `b6af3041` (11:47:41Z) started `Open-Box Docker Hub` run `41198324701`, which was cancelled at 11:59:36Z **inside** `docker/build-push-action`; `main-b6af304` was never created and `:latest` stayed on the previous build |
| What production actually served at 12:10Z | `Build at: 2026-10-31 11:49:08 +0000`, `Commit: 08c9f6c`. That SHA exists in neither `hillstreet-ph/open-box` nor `OpenListTeam/OpenList`; it is the synthesized commit the `Dockerfile` fallback produces (`git init` + `git commit`), and no published Docker Hub tag carries that stamp. The served entry asset is `index-CelfHslL.js` with a `rolldown-runtime` chunk — the upstream dist, not the fork build. Treat the running container as an artifact this repository's CI did not publish, and identify it from the Zeabur service definition before promoting |
| Ready artifact | `hillstreet/open-box:main-0e3fbac` and `:latest` → `sha256:4cb455ac7aed0f5206d04c6ac632b4302440ae91b67532abbf459d893eafcc82`, pushed 12:44:09Z, `linux/amd64` + `linux/arm64`. PR #61 passed `FRONTEND_REPO` into the image build, so this is the first published image that embeds the fork dist; the build log extracts `./assets/index-D-qN4CSQ.js` |
| Staging validation of the same source | Against the locally built binary: bogus `obk_*` → `Invalid or expired access token`; `fs:read` PAT lists but cannot `fs/mkdir` (`missing required scope: fs:write`); PAT is rejected on `me/token/list`, `fs/link`, `admin/storage/list` (`requires a login session`); `task:read` PAT reads `/api/task/copy/undone` and is refused `/api/task/copy/cancel` (`missing required scope: task:write`); invalid scope names are rejected at creation; a revoked PAT returns 401 on reuse; `/mcp` authenticates the PAT and replies `MCP server is not enabled` until the setting is turned on |
| Report step defect | `Report the running artifact` used an unescaped backtick in the `- service:` line, so any early exit produced a second, misleading shell error (run `41201462506`). The step now computes the post-promotion stamp first and writes the summary as one block |

Not yet done, and deliberately not claimed: no Zeabur write was issued, so the live production gate (image digest pinning, PAT routes at `open-box.space`, database-backed listing through the edge, TLS, restart recovery, the served frontend asset) is still unverified. The command is recorded, not executed:

```sh
gh workflow run openbox-deploy.yml --repo hillstreet-ph/open-box \
  -f image_tag=main-0e3fbac \
  -f expected_frontend_asset=index-D-qN4CSQ.js \
  -f "rotate_confirmed=yes — allow write"
```

`rotate_confirmed` asserts that the historically exposed Supabase, Docker Hub and Zeabur management tokens were rotated ([PLATFORM_BACKEND.md](../PLATFORM_BACKEND.md)); only the account owner can make that statement truthfully.


## Session durability: `token is invalidated` after every redeploy

Reported 2026-10-31: signing in to `open-box.space` and then letting the container restart (or a promotion roll it) returns `{"code":401,"message":"token is invalidated"}` for the browser session. Two independent mechanisms produced it, both in the session layer rather than in the personal access tokens:

| Mechanism | Where | Effect |
| --- | --- | --- |
| Issued-session allow-list held in process memory | `server/common/auth.go` kept `validTokenCache` and `ParseToken` checked it before anything else | A restart empties the cache, so every token that was logged in before the restart is rejected with exactly that message, even a correctly signed, unexpired one |
| `JwtSecret` regenerated per boot | `conf.DefaultConfig` writes `random.String(16)` when `<dataDir>/config.json` is missing, and the service has no persistent volume | The signing key changes with each container, so previous signatures no longer verify either |

The fix keeps both properties durable:

- the signing key is stored as the `jwt_secret` setting (`internal/conf/const.go`, seeded in `internal/bootstrap/data/setting.go` from `OPENLIST_JWT_SECRET` or `config.json` on the first boot). `common.JwtSecret()` prefers the stored row, so a regenerated config file can no longer rotate the key; `server/router.go` calls `common.UseDurableJwtSecret()`, and a settings change rotates the key immediately instead of at the next restart.
- signing out is recorded as a revocation in `x_revoked_sessions` (`internal/model/revoked_session.go`), storing only the sha256 of the session token plus its own expiry. `server/common/auth.go` now mirrors that table in memory and refreshes at most every 10 seconds, so a request still costs no extra query, logout stays per-session rather than per-user, and a reload failure keeps the previous view instead of logging everyone out. Rows are pruned once the token expired on its own.

Validated against a locally built binary with sqlite, an ephemeral config file and three successive boots:

| Check | Result |
| --- | --- |
| Session issued on boot 1, config `jwt_secret` rotated, boot 2 | `GET /api/me` → `200` (was `401 token is invalidated`) |
| Stored `jwt_secret` after two rotations | still the boot-1 value (`ReNFNS…`) while `config.json` held `qwVKGN…`, then `FlzD6a…` |
| `GET /api/auth/logout` with session A, boot 2 | session A → `401 token is invalidated`; session B from the same user → `200` |
| Same revoked session A after a third boot with another rotated secret | still `401` — the revocation survived the restart |
| `POST /api/fs/list` with a live session after a restart | reaches the storage layer (`failed to get storage` on a mount-less instance), i.e. authentication passed |

`server/common/auth_test.go` covers each of these, and `Test Build` now runs `./server/common` and `./internal/op` so the session layer is gated, not just `./server/handles` and `./server/mcp`.

The review round on PR #66 hardened four details of that first cut, all of them in `server/common/auth.go` unless noted:

- the expiry recorded with a revocation is read from the **verified** token, with the configured session lifetime as the fallback. The first version used `ParseUnverified`, which CodeQL flagged correctly: an unverified claim is attacker-chosen, so a token holder could pick how long its row survives. A non-positive `TokenExpiresIn` no longer wins either, which would have dated a revocation into the past and let the hourly prune drop it while the token was still live.
- the revocation is persisted before it is applied in the process. The first version did the opposite, so a failed insert left a session signed out locally and fully valid again after the next restart.
- the signing key is behind `SigningKey()`/`SetSigningKey()` guarded by an `RWMutex` instead of the exported `SecretKey` global, because the settings-change callback replaces it while requests are in flight. `TestSigningKeyRotationIsVisibleToConcurrentRequests` runs clean under `go test -race ./server/common`.
- one normalization point, `sessionCredential`, is used both to hash the credential and to read its expiry. `LogOut` is handed the raw `Authorization` header, so hashing exactly what arrived would store a revocation under a value no request path looks up when a client sends the `"Bearer "` form at sign-out. `TestLogoutAcceptsTheAuthorizationHeaderForm` pins that invariant. `internal/model/revoked_session.go` also declares `size:64` on the hash column so an index-backed varchar has a bounded width on MySQL deployments.

One consequence for the rollout: the first boot of this build seeds `jwt_secret` from whatever the running container's config file holds, so the sessions issued by earlier builds still stop working once. Sign in again after the promotion and every later restart keeps that session.


## Remaining rollout gates

- Workflow dispatch is available again. Run `41201462506` dispatched `openbox-deploy.yml` successfully and stopped at the rotation precondition, so the earlier 422 ("Actions disabled for the account") gate no longer applies. The remaining gate is the human rotation attestation, not platform access.
- Backend image build, immutable digest verification and staging rollout are still required. The current Zeabur image label and embedded binary commit differ; do not claim the tag is proof of deployed source.
- Runtime `x_*` tables are in `public`, not the intended isolated `open_box` schema. Verify an encrypted backup and reversible migration before moving tables or changing search_path.
- No persistent volume was observed on the service. Do not create a local storage mount on the container filesystem and describe it as durable. The session fix above works without a volume because both the signing key and the revocations live in the database; after promoting, verify through the edge that a session survives a redeploy and that a logged-out session stays logged out.
- Supabase OAuth Server/client registration, exact approved MCP client IDs, explicit SSO subject/account linking, and signed-in MCP tools/list + file read remain unverified. See [CHATGPT_MCP.md](CHATGPT_MCP.md).
- Open-Connect Google registry rows are capability grants, not verified native storage credentials. This Composio workspace exposed one verified Drive account; that does not establish access to every account in Open-Connect.
- Native GoogleDrive drivers cannot consume opaque connector metadata. An approved scoped filesystem broker or separate per-account native authorization is required. Non-executable Open-Connect adapter draft: `314835cc-b657-4d4c-8de7-e4bdcd58c51b`.

## Account organization

Use `/google-drive/<account>` for each verified Google account, and unique provider/account mounts for other storage. Keep personal and workspace identities separate. Validate account identity, scopes, listing, and reading before marking any mount connected. Source collection uses copy; never propagate deletions.

Secrets remain in their existing server-side stores. No refresh tokens, access tokens, passwords or database secrets are included in this report. Supabase Auth health does not verify database, file storage or backups.
