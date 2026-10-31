# Open-Box production status

Verified 2026-10-10. Public application: https://open-box.space.

As of 2026-10-31 19:45Z the service runs `hillstreet/open-box:main-35a4ce0` (manifest digest `sha256:06f4e068…`, `Build at: 2026-10-31 19:12:47 +0000`) with the fork frontend's `index-D-qN4CSQ.js`; the table below is the 10-10 snapshot it grew out of, and the fourth-pass section records the promotion that put this build in place.

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

## Promotion executed: 2026-10-31 (third pass) — production now runs the scoped-token build

The operator authorized merge and deployment and answered the rotation attestation. Run `41217330696` (`workflow_dispatch`, 15:57:46Z) pinned the service and rolled it; every write step succeeded.

| Fact | Evidence |
| --- | --- |
| Promoted artifact | `hillstreet/open-box:main-a15ceb3` → `sha256:8c8671582ad32cc84f1c0552c43f81a722774b31de82347151a200fb19e86a6a`, pushed 15:54:16Z |
| Why the first write attempt failed | Run `41212924215` died at `Trigger the promotion` with `select project failed: EOF` because the Zeabur CLI defaults to interactive mode; PR #63 added `--interactive=false` to every call |
| Service topology | Read-only diagnostics (runs `41214761444`, `41217095410`) show project `6a966cc0a85370460248e847` contains two `PREBUILT_V2` services. `Open-Box` (`6a967b310e919aed614685ce`) owns `open-box-space.zeabur.app` on port `5244` and is the promotion target. `open-box-next` (`6adf9e880ca070d4379475d0`) has **no domains** and builds from `refs/heads/main` — it is the service that kept rebuilding itself, so those rebuilds were never production rollouts |
| Why `service get` looked broken | The Zeabur CLI returns PascalCase (`ID`, `Name`, `Project.ID`, `Template`, `State`) and prefixes some responses with colored `INFO` lines. The workflow read lowercase keys, printing nulls for a binding that was correct all along. PR #64 reads both shapes and refuses to pin a tag unless the target service owns the origin host |
| Production after the roll | `/api/public/settings` reports `v0.0.0 (Commit: b145091) - Frontend: v4.2.9 - Build at: 2026-10-31 15:25:53 +0000` (the synthesized commit of this image build; the stamp, not the SHA, identifies it) |
| Scoped tokens are live | `POST /api/fs/list` with bearer `obk_gatecheck` now returns `Invalid or expired access token` instead of `token is invalidated` |
| Fork frontend is live | `open-box.space/` serves `/assets/index-D-qN4CSQ.js` and `/assets/index-legacy-aJ_3kIsw.js`, i.e. the `ce49abd` fork dist with Home and Profile in the `/manage` header |
| Gate assertion defect | The run still reported failure: `Production gate` compared only the **first** `/assets/index-*.js` reference in `index.html`, which is the legacy chunk, so it rejected a correct deployment. Fixed by checking all served assets; the same change adds a `verify only (no write)` mode so re-verification does not need a rollout |
| Anonymous listing | `POST /api/fs/list` without credentials returns `401`; listing requires auth in this deployment and is recorded, not treated as a failure |

Verified by this promotion: image pinning and container rollout, the PAT discriminator, the token route reply, database-backed public settings through the edge, TLS at the edge, and the served frontend identity. **Not** verified: restart recovery, storage read/write through the mounted volume, and any signed-in MCP or OAuth flow.


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

The review round landed as PR #66 → `35a4ce0` on `main`, and the same binary was re-checked over HTTP against the data directory left by the pre-review run (no credentials involved: the two sessions were the ones the earlier build had already issued and revoked):

| Check on the reviewed binary | Result |
| --- | --- |
| Boot 4, `GET /api/me` with the session the previous build issued and never signed out | `200` — durability survived a full rebuild, not just a restart |
| Boot 4, `GET /api/me` with the session the previous run signed out | `401 token is invalidated` — the persisted revocation is read by the new code |
| Boot 5 (a second restart of the reviewed binary) | same: live session `200`, revoked session `401` |
| `POST /api/fs/list` with the live session | `500 failed get storage: storage not found`, i.e. authentication passed and the request reached the storage layer |
| `x_revoked_sessions` in the sqlite data directory | present, with the boot-4 row still holding the boot-2 revocation |

The corrected gate from PR #65 was also exercised against live production in `verify only (no write)` mode (run `41231810436`, success, 18:56Z): `/ping` → `pong`, a bogus `obk_*` bearer answered `Invalid or expired access token` rather than `token is invalidated`, `/api/public/settings` read from the database through the edge, TLS verified, and the served entry assets were `/assets/index-D-qN4CSQ.js` + `/assets/index-legacy-aJ_3kIsw.js`, i.e. the fork frontend. `Production gate passed for latest.` — the previous run's failure really was the legacy-chunk false negative, not a bad deployment.

One consequence for the rollout: the first boot of this build seeds `jwt_secret` from whatever the running container's config file holds, so the sessions issued by earlier builds still stop working once. Sign in again after the promotion and every later restart keeps that session.

### Promotion executed: 2026-10-31 (fourth pass) — the session fix is live

The owner attested that the exposed management credentials were rotated ("Rotated — deploy it"), which is the precondition `rotate_confirmed` encodes, so the write-enabled run went out at 19:44Z and passed in 1m12s (run `41235611739`):

| Step | Result |
| --- | --- |
| Confirm the rotation precondition | passed on `rotate_confirmed=yes — allow write` |
| Resolve the immutable image digest | `main-35a4ce0` → manifest list `sha256:06f4e068b4c16d6b7d45a8d479b759cc350104ad50effdce842b0b89bfebb14c` (amd64 `sha256:9c155d7f…`, arm64 `sha256:0603c131…`) |
| Capture the current state (rollback reference) | previous version recorded as `Build at: 2026-10-31 15:25:53 +0000`, i.e. `main-a15ceb3` |
| Trigger the promotion, wait for ready | service reported ready |
| Production gate | `Production gate passed for main-35a4ce0.` |
| Report the running artifact | digest above |

Re-checked independently against the edge after the roll:

| Live check | Result |
| --- | --- |
| `GET /api/public/settings` | `200` in 0.6 s, `version: v0.0.0 (Commit: 80cbddf) - Frontend: v4.2.9 - Build at: 2026-10-31 19:12:47 +0000` — the new stamp, not the 15:25 one |
| `Authorization: obk_deadbeef` on `/api/me` | `401 Invalid or expired access token` — the PAT-aware auth layer is what is serving |
| malformed JWT on `/api/me` | `401 couldn't handle this token` — signature verification, not the old in-memory allow-list |
| `POST /api/fs/list` as a guest | `401 Guest user is disabled, login please` — authentication is enforced, so browsing needs a session |
| `GET /` and `/assets/index-D-qN4CSQ.js` | `200`, fork frontend entry chunks served |

What these checks do **not** establish: that a real browser session survives the next production redeploy. That is the headline property of the fix and it needs a signed-in session to observe; the mechanism itself is covered by `server/common/auth_test.go` and by the five boot-to-boot HTTP checks on the staged binary above. Sign in once now — the first boot of this build seeded `jwt_secret` from the container's config file, so sessions issued by earlier builds stop working exactly once — and every later restart keeps it.

## Blank page plus `The operation either timed out or was not allowed.`

A screenshot of open-box.space at 03:37 local on 11-01 showed the boot spinner with ten stacked toasts: five `Token is invalidated` and five `The operation either timed out or was not allowed.`

The second message is not ours. `grep` finds it in neither this repository nor the fork frontend, and the backend and static delivery were both answering in under a second when the site was probed during that window. It is the engine's own text for an XHR that never completed — Chrome and Safari surface it when a request is aborted, which is what a tab restored from sleep, a dropped connection, or a container mid-restart produces. It reaches the user verbatim because the frontend's response interceptor falls back to `error.message` whenever there is no server `message` to show.

That fallback is one of two client-side defects that turn a transient failure into a stuck page, both in the fork frontend:

- An aborted or offline request resolves to `{ code: undefined }`, so `handleResp` shows its toast and takes no further action. With no server reply there is no 401 to react to, and the boot never recovers or explains itself.
- A 401 redirects to `/@login` but leaves the rejected token in `localStorage` and in the shared `Authorization` default header, so every request the login page's own boot issues is rejected the same way. That is why the same error arrived five times instead of once.

`OpenList-Frontend` PR #3 fixes both: transport failures get an actionable sentence (offline versus 502/503/504 versus a deliberate cancel) through a new `src/utils/request_error.ts`, and `handleResp` clears the credential with `changeToken()` before navigating. The error envelope's shape is untouched on purpose — `pages/home/uploads/multipart.ts` distinguishes a transport failure from a server envelope by `"data" in resp` and `code === -1`, and `hooks/usePath.ts` branches on `code === undefined`. Locally: `pnpm test` 45 pass (5 new), `pnpm lint` 13 errors — the identical count with the change stashed, none in the touched files — and `pnpm build` succeeds with no circular-import warning.

## Developer tokens could not be used by the clients they were built for

Verified against the live service after the fourth promotion, same endpoint and same token, only the header spelling differing:

| `Authorization` on `GET /api/me` | Reply |
| --- | --- |
| `obk_deadbeef` | `401 Invalid or expired access token` — the access-token path answered |
| `Bearer obk_deadbeef` | `401 that's not even a token` — fell through to session parsing |
| `Bearer obk_deadbeef` on `POST /mcp` | `401 that's not even a token` |

Browsers and the SDK send the token as the whole header value; OAuth-style clients — MCP servers, ChatGPT plugins, most HTTP libraries — send the `Bearer` scheme. PR #66 normalized that scheme at logout only, so a token presented the way those clients present it never reached the access-token check. Recorded in PR #66's own notes as the follow-up: *"a separate PR for consistent scheme handling."*

PR #68 makes `common.Credential` the single normalization point and routes every reader through it — both auth middlewares, `IsPAT`/`ResolvePAT`, `ParseToken`, `AuthMCP` (which also gets the constant-time site-token comparison the middlewares already used) and the WebDAV bearer branch. Two things worth keeping from the review of that fix:

- A first cut of the middleware test asserted on the HTTP status and passed for every credential, broken or not: `ErrorStrResp` answers **HTTP 200** and carries the status in the JSON body. Tests in this area have to read the envelope. Confirmed against the pre-fix code both ways — with the middleware normalization removed the site token sent as `Bearer …` answers `401 that's not even a token`; with `IsPAT`/`ResolvePAT` normalization removed an issued token in the scheme form is not recognized.
- `AuthMCP` in OAuth mode still does not accept access tokens at all: with `MCP.OAuthIssuer` configured, an `obk_` credential matches neither the site token, nor a session, nor a Supabase ID token. Production reaches `/mcp` through `middlewares.Auth` today (no issuer configured), so PR #68 does make tokens work there; the OAuth-mode branch belongs with the MCP warehouse surface rather than riding on a normalization change.

## Sign-in would not recover: the attempt guard never let go

The report after the fourth promotion was that the login flow was broken — a page that kept refusing to sign in. Three causes were separated; one of them was a misreading of my own probe.

**`GET /api/auth/login?username=admin` answering with the SPA `index.html` is not a routing fault.** The prelogin route is registered POST-only (`server/router.go:75`, `api.POST("/auth/login", handles.Login)`), and an unmatched path falls through to the static handler, which serves the app shell with HTTP 200. The frontend signs in through `POST /auth/login/hash` sending `sha256(password + "-" + StaticHashSalt)`, which is exactly `model.StaticHash` on the server (`internal/model/user.go:235`); the live service answered that route with a normal API envelope (`{"code":401,"message":"Invalid username or password"}` over HTTP 200). The sign-in endpoint is intact.

**Rotating `OPENLIST_ADMIN_PASSWORD` changes nothing once the administrator exists.** `initUser()` reads the variable and uses it only inside the `gorm.ErrRecordNotFound` branch that *creates* the admin row; on an installed database the value is discarded silently. An operator who rotates the environment variable — as the credential-rotation gate asked for — then finds the service rejecting the new password while the original one still works, with no message to explain it. `reportInitialPassword` now compares the environment value against the existing administrator at boot and prints, on the console only, that it was ignored and how to apply it deliberately; `OPENLIST_ADMIN_PASSWORD_RESET=1` opts in to applying it, because silently overwriting a live account is not a safe default for a value that is meant for first boot.

**The failed-attempt guard is what actually keeps a person out.** A count was written with `LoginCache.Set(ip, count+1)` — no deadline, and go-cache only expires entries that are given one — so failures accumulated for the lifetime of the process: three typos in the morning left the account two mistakes from a lockout that evening. And every rejection while locked called `Expire(ip, DefaultLockDuration)`, pushing the deadline forward, so a client that retried more often than once per five minutes was never released. That is exactly what a locked-out person does. The same six lines were repeated in `handles/auth.go`, `handles/ldap_login.go`, `webdav.go`, `ftp.go` and `sftp.go`, and the two protocol servers keyed by `RemoteAddr().String()` — including the ephemeral port — so every TCP connection got its own counter.

Evidence from the Zeabur origin on 2026-10-31, using a username that does not exist so no real account was targeted and no password was guessed:

| time (UTC) | attempts | reply |
| --- | --- | --- |
| 20:46:19 – 20:46:53 | 5 | `401 Invalid username or password` — the counter filling |
| 20:48:29, 20:50:00 | 1 each | `401` again, although five failures were already recorded |
| 20:51:31, 20:53:03, 20:54:34 | ~93 s apart | `429 Too many unsuccessful sign-in attempts … Try again later.` with no time given |
| 20:56:05, 20:57:36, 20:59:07 | same cadence | back to `401` |

A lock re-armed at 20:54:34 for five minutes cannot free the client at 20:56:05, and five recorded failures cannot be answered with two 401s, unless the in-memory counter is not one authoritative thing in this deployment. Either the service runs more than one process or replica, or the address Gin derives from `X-Forwarded-For` is not stable per client — Gin trusts every proxy by default and the origin answers directly, so that header is not a trustworthy identity either. Under both readings the operator sees the same thing: the same wrong password alternates between "invalid" and "too many attempts", and "try again later" is not a promise the guard kept.

The fix puts one policy behind `internal/model/login_guard.go` and routes all six authenticators through it: each failure counts for `DefaultAttemptWindow` (10 min) and the window restarts on failure, so mistakes decay; reaching the limit replaces the window with a lock whose deadline is set once, by the attempt that reached the limit; retries while locked report the time remaining and never extend it; a successful sign-in clears both entries; and `LoginKeyFromAddr` strips the port so FTP and SFTP count per client instead of per connection. The rejection now names the wait (`… Attempts unlock in 4m12s.`), and the locked address is logged at debug level so an operator locked out of their own service can see what was counted.

Tests: `internal/model/login_guard_test.go` (decay, lock not extended by retries, clear on success, message, address keying) and `server/handles/login_guard_test.go` (the real `POST /api/auth/login/hash` through Gin against sqlite, asserting the **envelope** code — `ErrorStrResp` answers HTTP 200). Both were checked for vacuity by re-implementing the old policy in `login_guard.go` and re-running: the model test fails with `LoginFailures after the window = 3, want 0` and the handler test with `retry 1 extended the lock: 300ms -> 300ms`. After restoring the fix, `go build ./...`, `gofmt -l` clean, and `go test ./server/... ./internal/model/... ./internal/bootstrap/...` all pass. One pre-existing failure is unrelated to this change and was not introduced by it: `TestRapidUploadShortCircuit` in `internal/multipart`, plus three `non-constant format string` vet findings in `internal/offline_download/*` under Go 1.26.

What this does **not** fix: the counter is still process-local, so with more than one replica a client can still get a fresh budget on each one — a database-backed guard would be needed for that, and the replica count is still unverified because this repository has no Zeabur access. What an operator locked out of the **current** build should do: stop retrying for five full minutes — retries extend the lock — then sign in with the password the account actually has, not the rotated environment value.

## Sign-in answered `Failed to connect to LDAP … missing address` for a password

Reported 2026-11-01: the administrator could not sign in and the page said

```
Failed to connect to LDAP: LDAP Result Code 200 "Network Error": dial tcp: missing address
```

Nobody was trying to log in over LDAP. The flag made them.

`ldap_login_enabled` is a **PUBLIC** setting, so `/api/public/settings` publishes it, and the sign-in page treats it as the instruction for how to sign in at all: `OpenList-Frontend/src/pages/login/index.tsx` sets `useLdap` to true whenever it is true, and the Login button then posts to `/auth/login/ldap` instead of `/auth/login/hash`. The live service answered `ldap_login_enabled = 'true'` (with `ldap_login_tips = 'login with ldap'`), while `ldap_server` — PRIVATE, so not visible from outside — had no host in it. One call to each route, from the same machine, at 21:36Z:

| route | production answer |
| --- | --- |
| `POST /api/auth/login/ldap` | `{"code":500,"message":"failed to connect to LDAP: LDAP Result Code 200 \"Network Error\": dial tcp: missing address"}` |
| `POST /api/auth/login/hash` | `{"code":401,"message":"Invalid username or password"}` |

The password route is healthy and reachable; the page simply was not using it. `dial tcp: missing address` is what `ldap.Dial("tcp", "")` returns — the setting box was empty (or held only a scheme), and `HandleLdapLogin` passed it straight to the socket. This is the third distinct cause in the sign-in flow, alongside the guard that would not let go and the initial-password variable that says nothing when it is ignored.

The fix is one question — *can LDAP sign-in actually be offered?* — asked by every surface that would otherwise hand somebody to a directory:

- `internal/conf/ldap.go` holds the rule as pure functions: `LdapDialTarget` turns the free-text `ldap_server` into a `host:port` (accepting a bare host, `ldap://`/`ldaps://`, and bare or bracketed IPv6, and implying 389/636 from the scheme) or says which setting is wrong and how to fix it; `LdapSignInProblem` adds only what genuinely cannot work — no address, or a search filter with no `%s` for the username. The search base is deliberately **not** required: some directories answer a search from the root, and calling such a deployment unusable would switch off the only sign-in its users have.
- `internal/setting/ldap.go` exposes that as `LdapSignInProblem()` over the stored settings, so the HTTP route, the protocol servers and the public view cannot drift apart.
- `PublicSettings` answers `ldap_login_enabled = "false"` while the directory is unusable. The public flag now means "LDAP sign-in is available", not "somebody ticked a box". The stored setting is untouched — under Settings the operator still sees what they set, next to the field that needs filling.
- `HandleLdapLogin` refuses before touching the network, and WebDAV, FTP and SFTP gate their LDAP fallback on the same answer, so a half-configured directory no longer replaces the local password error (and no longer opens a connection attempt per mistyped password).
- `LoginLdap` names the missing setting instead of a transport error, keeps 403 for "not enabled", answers 500 for "enabled but unusable", and records no failed attempt — a service's own misconfiguration must not lock a client out, which the guard from the previous section would otherwise have done after five tries.

Tests: `internal/conf/ldap_test.go` (both tables, including every message naming the setting key), `server/common/ldap_test.go` and `server/handles/ldap_login_test.go` (the real routes through Gin, asserting the **envelope** code and `data.ldap_login_enabled`, plus that the stored setting is not rewritten and `model.LoginFailures` stays 0). All three were checked for vacuity by re-implementing the old policy — the original `dial` prefix-trimming, the original `enabled := …` check, the original public-settings body — and re-running: the common test fails on `want it to mention "ldap_server"` and `want no transport error`, the handler test on the same two, and the public-settings test on `public ldap_login_enabled = "true", want "false"` — while printing the exact production message quoted above. After restoring the fix, `go build ./...` and `go vet` on the touched trees are clean and `go test ./server/... ./internal/conf/... ./internal/model/... ./internal/bootstrap/...` passes; the pre-existing `TestRapidUploadShortCircuit` failure and the three `internal/offline_download` vet findings are unchanged and unrelated.

What this does **not** do: it does not change the row in the production database, and production still runs `main-35a4ce0`, which cannot be replaced while the account's Actions runners are locked. So the flag is still `true` there, and until this ships the sign-in page still defaults to LDAP. Two ways in, today: on the sign-in page, **untick** `login with ldap` — the checkbox is rendered because the flag is on, and the password route behind it works — then set a real address under Settings › LDAP or switch the flag off; or, if the UI is not reachable, one statement against the `x_settings` table does the same, and it is reversible:

```sql
UPDATE public.x_settings SET value = 'false' WHERE key = 'ldap_login_enabled';
```

The setting cache reloads on the next write through the API, not on a bare SQL update, so after running it restart the service (or save any setting through the admin UI) before checking.

The forcing is visible in the bundle that is being served right now: `assets/login-DitYO93_.js` contains `$ = m("ldap_login_enabled"), ve = v("ldap_login_tips"); … $ && U(!0)` — `setUseLdap(true)` while the flag is true — and behind it a `Show when={…}` block renders `Checkbox … onChange: () => U(!H())` with `children: ve`, which is the untick. So the escape hatch is in the page itself. That is read from the served asset, not from a browser session: this repository has no browser access here, so the click-through is not observed.

## Blocked: GitHub Actions runners are locked to the account

At 20:02Z the two CodeQL jobs for `OpenList-Frontend` PR #3 failed after 3 s without a log, annotated `The job was not started because your account is locked due to a billing issue.` A `verify only (no write)` dispatch of `openbox-deploy.yml` at 20:04Z (run `41237151949`) failed the same way in 5 s, so the lock is account- or organization-wide, not repository-specific — the same workflow had succeeded 18 minutes earlier, and both repositories are public, so no code change explains it. Nothing in the repositories needs fixing; a payment method or spending limit does, at `https://github.com/settings/billing` (organization billing for `hillstreet-ph`).

Until that clears, no image can be built, no frontend release published, and no promotion dispatched. Production is unaffected: it is running `main-35a4ce0`.

Re-checked at 21:43:44Z, after the sign-in fixes merged: the push produced four runs — `Beta Release (Docker)` `41244929222`, `Open-Box Docker Hub` `41244929190`, and CodeQL `41244929050` / `41244929133` — each 3 to 5 seconds long with no steps, the build job annotated the same billing message.

Merging did not need runners, and is done: `open-box#68` (credential normalization) landed as `1819ac78`, `open-box#67` (these notes) as `d2c1cf8b`, and `OpenList-Frontend#3` as `3630a5c6`, followed by `open-box#69` (the sign-in attempt guard) as `f631052a` and `open-box#70` (LDAP sign-in availability) as `6e2b78dd` — so the next promotion target is the image of `main-6e2b78d`. Their CI checks never ran, so each was verified locally instead — `go build ./...`, the package suites above, and the frontend suite — and that is recorded as a substitute for CI, not as CI passing.

Once runners are available again, the shortest path is: dispatch `build_rolling.yml` on the frontend repository with `draft=false` to publish the `edge` release that `build.sh` prefers; merge the LDAP-availability PR, whose push produces `main-<sha>` embedding that dist; then promote it with the gated command, using the entry-chunk name served at that moment for `expected_frontend_asset`. A backend merge alone produces a shippable image one commit sooner, so if the frontend release stalls, promoting the backend build is still worth doing on its own — and it is the login-flow fixes that are waiting on the image, not the frontend.


## Remaining rollout gates

- Workflow dispatch is blocked again, by billing rather than by permissions: see the runner-lock section. The earlier 422 ("Actions disabled for the account") and the rotation attestation are both resolved — `openbox-deploy.yml` ran write-enabled and passed as run `41235611739` — but no run starts until the account's Actions billing is settled.
- Credential rotation is outstanding and is now the top item. Alongside the historically exposed Supabase, Docker Hub and Zeabur management tokens, values pasted into chat on 2026-10-31 must be rotated: the administrator password (`ADMIN_PASSWORD` / `OPENLIST_ADMIN_PASSWORD`), the database password (`DB_PASS`), and a GitHub personal access token. None of them were used by CI, and none are recorded in this repository. The owner attested rotation for the promotion gate; that attestation is not evidence this repository could verify, and the pasted GitHub PAT in particular should be confirmed revoked at `https://github.com/settings/tokens`.
- Image build, immutable digest verification and the production rollout are done for both `main-a15ceb3` (third pass) and `main-35a4ce0`, the session-durability build (fourth pass). Do not treat the embedded `Commit:` value as a repository SHA; it is synthesized by the `Dockerfile` builder fallback — identify an image by its `Build at:` stamp and served asset names. `main` now also carries the credential normalization, the sign-in guard fix and the LDAP-availability rule, so the next promotion target is the first image CI can build from that state, together with a frontend `edge` release that has not been published yet. The LDAP row is a stored setting, so the `ldap_login_enabled = 'true'` in the production database is not changed by any of this until the image ships — see the sign-in section above for how to sign in meanwhile.
- Runtime `x_*` tables are in `public`, not the intended isolated `open_box` schema. Verify an encrypted backup and reversible migration before moving tables or changing search_path.
- No persistent volume was observed on the service. Do not create a local storage mount on the container filesystem and describe it as durable. The session fix works without a volume because both the signing key and the revocations live in the database. Still to observe in production: a signed-in session surviving a redeploy, and a signed-out session staying rejected — both need one authenticated session, which is why they are recorded as unverified rather than as passing.
- Supabase OAuth Server/client registration, exact approved MCP client IDs, explicit SSO subject/account linking, and signed-in MCP tools/list + file read remain unverified. See [CHATGPT_MCP.md](CHATGPT_MCP.md).
- Open-Connect Google registry rows are capability grants, not verified native storage credentials. This Composio workspace exposed one verified Drive account; that does not establish access to every account in Open-Connect.
- Native GoogleDrive drivers cannot consume opaque connector metadata. An approved scoped filesystem broker or separate per-account native authorization is required. Non-executable Open-Connect adapter draft: `314835cc-b657-4d4c-8de7-e4bdcd58c51b`.

## Account organization

Use `/google-drive/<account>` for each verified Google account, and unique provider/account mounts for other storage. Keep personal and workspace identities separate. Validate account identity, scopes, listing, and reading before marking any mount connected. Source collection uses copy; never propagate deletions.

Secrets remain in their existing server-side stores. No refresh tokens, access tokens, passwords or database secrets are included in this report. Supabase Auth health does not verify database, file storage or backups.
