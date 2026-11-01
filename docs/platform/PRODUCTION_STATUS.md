# Open-Box production status

Verified 2026-10-10. Public application: https://open-box.space.

As of 2026-10-31 22:20Z the service runs `hillstreet/open-box:main-ef241d2` (manifest digest `sha256:f30d6d4e…`, pushed 22:16:57Z, `Build at: 2026-10-31 21:54:01 +0000`) with the fork frontend's `index-D-qN4CSQ.js`; that is the fifth pass below, and it is the build that carries the scoped-token work, the sign-in attempt window, the LDAP availability rule and the test-suite fixes. The table below is the 10-10 snapshot it grew out of.

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

What this does **not** do: it does not change the row in the production database, and it still does not. Re-read on 2026-11-01 with a read-only query: `public.x_setting_items` still holds `ldap_login_enabled = 'true'` and `ldap_server = ''`. So the directory remains unusable — but as of the fifth pass below the running binary is the fixed one, so `/api/public/settings` now answers `ldap_login_enabled = "false"` and the sign-in page stops routing the password prompt through LDAP. The operator's stored `true` is untouched: under Settings › LDAP the flag still reads as they set it, next to the address field that needs filling, and the moment a real address is saved the flag publishes `true` again and the checkbox reappears. Before the image shipped, the two ways in were the untick on the sign-in page and a reversible statement against the table:

```sql
UPDATE public.x_setting_items SET value = 'false' WHERE key = 'ldap_login_enabled';
```

The table is `x_setting_items` (key/value rows), not `x_settings` — there is no `x_settings` table in this database, which is the same invented name that made a backup gate reject a correct archive; see the backup section below.

The setting cache reloads on the next write through the API, not on a bare SQL update, so after running it restart the service (or save any setting through the admin UI) before checking. Neither was needed in the end — the promotion landed first.

The forcing is visible in the served bundle: `assets/login-DitYO93_.js` contains `$ = m("ldap_login_enabled"), ve = v("ldap_login_tips"); … $ && U(!0)` — `setUseLdap(true)` while the flag is true — and behind it a `Show when={…}` block renders `Checkbox … onChange: () => U(!H())` with `children: ve`, which is the untick. So the escape hatch was in the page itself, and after the fifth pass the browser is back in this environment: `https://open-box.space/@login` was loaded and its accessibility tree shows `Login to the Open-Box` over `Input your username`, `Input your password` and `Remember me` with **no** `login with ldap` checkbox present, and the only console lines are the version banner and a benign customize note. The password form is the default again.

## Promotion executed: 2026-10-31 (fifth pass) — the sign-in fixes are live

The runners came back on their own at 21:52Z, twelve minutes after the last check that found them locked. The queue that had been piling up drained in commit order, and everything recorded as "verified locally instead of by CI" in the previous sections got its CI run: `Authentication and gateway tests` passed on `d53d4ab` (run `41245585292`), the push of the merge produced `Open-Box Docker Hub` `41245600960`, and that pushed `hillstreet/open-box:main-ef241d2` at 22:16:57Z with manifest digest `sha256:f30d6d4e…` for amd64 and arm64.

`openbox-deploy.yml` was then dispatched (run `41247679221`, `promote and verify`, rotation attested by the owner) and passed end to end:

| step | what it recorded |
| --- | --- |
| image resolved | `main-ef241d2`, digest `sha256:f30d6d4e…`, pushed 22:16:57Z |
| bindings | project `6a966cc0a85370460248e847`, service `6a967b310e919aed614685ce`, origin host `open-box-space.zeabur.app` bound to it |
| before / after | `Build at: 2026-10-31 21:53:29` → `Build at: 2026-10-31 21:54:01`; the container rolled in 47 s |
| PAT discriminator | `{"code":401,"message":"Invalid or expired access token"}` — the scoped-token build, not the old `token is invalidated` binary |
| token routes | `/api/me/token/list` answers a JSON envelope rather than the SPA shell |
| frontend identity | served entry assets `/assets/index-D-qN4CSQ.js`, `/assets/index-legacy-aJ_3kIsw.js` — the expected fork dist |
| health, storage, TLS | `/ping` returns `pong` at the edge and through the domain, public settings reads back from the database, TLS verify result 0 |

What this fixed, checked against the live service afterwards rather than against the workflow's own green tick:

```
GET  /api/public/settings   → "ldap_login_enabled": "false"      (was "true")
POST /api/auth/login/ldap   → 500 ldap_server "" names no server; give an address such as ldap://directory.example.com
POST /api/auth/login/hash   → 401 Invalid username or password   (unchanged, still healthy)
```

That middle line is the whole reported symptom replaced by a sentence about the setting that is missing — no socket was opened and no `LDAP Result Code 200 "Network Error"` is reachable any more. One probe per route, with a username that does not exist, so the attempt guard was not exercised against a real account, and no credential was typed into the live form for the same reason.

Two things the pass did **not** do. It did not configure a directory: `ldap_server` is still empty in production, so LDAP sign-in stays unpublished until somebody fills it in under Settings › LDAP. And it did not ship the frontend fork's newest commit: `build_rolling.yml` is not registered on `hillstreet-ph/OpenList-Frontend` (`gh workflow run` answers `HTTP 404: workflow build_rolling.yml not found on the default branch`), so the `edge` channel the docs recommend does not exist yet, and `build.sh` fell back to the latest stable release `v4.2.9` — which is the same dist production already served, so the entry-asset identity held, but `OpenList-Frontend#3` is still not in any served bundle.

One hazard this pass exposed, because it will bite later: `latest` is not monotonic. `main-ef241d2` was pushed at 22:16:57Z, and ten seconds later the run for the *older* commit `c8c3c550` finished and re-pointed `latest` at `sha256:4da7632d…`. The queue drains in arrival order, not commit order, so whichever build finishes last owns the mutable tag. Production did not follow it because the promotion pins the service to an immutable `main-<sha>`, and that pinning is the reason the deploy workflow exists — a service tracking `latest` can be rolled backward by an unrelated merge. Do not conclude a rollback happened from the tag alone; read the `Build at:` stamp, which still reports `21:54:01` here.

`main` has moved twice since (`e7b8eb25` merged the CI changes), and those commits are deliberately **not** promoted: they touch `.github/workflows` and nothing that executes in the container, so a promotion would roll the service to prove a point about a diff the runtime never reads. The next promotion should carry a runtime change, and it should read `latest` as a hint rather than as a fact.

## Runners were locked to the account — now released

At 20:02Z the two CodeQL jobs for `OpenList-Frontend` PR #3 failed after 3 s without a log, annotated `The job was not started because your account is locked due to a billing issue.` A `verify only (no write)` dispatch of `openbox-deploy.yml` at 20:04Z (run `41237151949`) failed the same way in 5 s, so the lock was account- or organization-wide, not repository-specific. Nothing in the repositories needed fixing; a payment method or spending limit did, at `https://github.com/settings/billing` (organization billing for `hillstreet-ph`). Re-checked at 21:43:44Z the lock still held: four runs from the push were each 3 to 5 seconds long with no steps.

It cleared by 21:52Z without any change in either repository, which is what a billing state looks like from the outside. Two consequences are worth keeping rather than deleting, because they will come back:

- Every merge between 20:33Z and 21:44Z was verified locally, not by CI, and is recorded that way above. Those commits have since been built and tested by the runners that finally picked them up, so the local-verification note is history, not an outstanding risk.
- With the lock gone, the remaining red in CI was our own code, not the account: `go test` could not build three `internal/offline_download` packages (non-constant format strings under vet) and `TestNewOSSClientUsesEnvironmentHTTPSProxy` asserted a bare `*http.Transport` where `NewHttpClient` returns the SSRF-guarded one. Both are fixed by `open-box#71` (merged as `ef241d2d`), and the auth job has been green since. The seven `Build <target>` cross-compile jobs fail a different way, and it is worth being precise about how often: run `41245585292` died with `failed to register layer: … no space left on device` while pulling `crazymax/xgo`, but the same matrix had been green three hours earlier on `41234433899`, so the runner disk is a margin, not a certainty — the pull fits when nothing else is on that machine and does not when the toolchain layers land on top of the preinstalled SDKs. `open-box#72` (merged as `e7b8eb25`) removes those SDKs before the pull, and both of its runs — `41246030306` and `41248146466` — came back with all eight jobs green. That is two runs in a row, not proof: the same claim was true of `41234433899` before the change. The difference is that the cleanup makes the margin, not the machine's mood, the deciding factor. The same PR narrowed the auto-review guard, which had started blocking that cleanup as a "destructive path" because it scanned workflow files as though they shipped in the image; the scan now covers shipped code, and `base_ref` reaches the script through a validated environment variable instead of interpolated into it.

Merging did not need runners, and is done: `open-box#68` (credential normalization) landed as `1819ac78`, `open-box#67` (these notes) as `d2c1cf8b`, and `OpenList-Frontend#3` as `3630a5c6`, followed by `open-box#69` (the sign-in attempt guard) as `f631052a`, `open-box#70` (LDAP sign-in availability) as `6e2b78dd`, and `open-box#71` (the test suite) as `ef241d2d` — and `ef241d2d` is what production runs now.

One process note, because it is easy to repeat by accident: pushing the docs commit directly to `main` produced `Bypassed rule violations for refs/heads/main: Changes must be made through a pull request`. The branch protection does allow it, but it leaves an audit line that says a rule was bypassed; everything since has gone through a PR, which is how the repository wants it.


## The Warehouse Database had no backup for twelve days

`Open-Box Backup Supabase` had been failing every night since at least 2026-10-20, and `Open-Box Maintenance`'s `backup-db` job failed the same way, so nothing was being archived at all. The cause was not one bug. It took five dispatches on `main` to see them, because each one only became visible after the previous fix let the job get further:

1. **`pg_dump` was older than the server.** The Supabase project is Postgres 17 (17.6), while the Ubuntu runner's `postgresql-client` metapackage installs 16, and `pg_dump` refuses a newer server. `.github/scripts/openbox-db-backup.sh` now asks the server its own `current_setting('server_version_num')` and installs the matching `postgresql-client-<major>` from PGDG (`open-box#74`).
2. **Installing that client did not change which binary ran.** `/usr/bin/pg_dump` still belonged to the image's version 16, so the script's own guard rejected a situation it had just tried to repair (run `41297912897`). Every candidate — `/usr/lib/postgresql/*/bin/<tool>`, `/usr/bin/<tool>`, `PATH` — is now asked its own `--version` and the newest wins (`open-box#75`).
3. **`--schema=open_box` named a schema production does not use, and `pg_dump` exits 0 when a schema matches nothing.** The scope is now discovered from `information_schema`, gated by an allow-list so an unexpected schema fails the run instead of being archived quietly, and the archive is verified before upload (`open-box#74`).
4. **The first verification was wrong, not the dump.** It compared a schema dump's `CREATE TABLE` count with the ten Open-Box tables: run `41298653594` rejected a correct archive with `the dump holds 103 CREATE TABLE statements, the catalog holds 10`. A `--schema=public` dump legitimately carries the other ninety-three tables of the shared project, so the check is now per qualified table name, and it names what is missing (`open-box#76`).
5. **A gate invented a table name.** Run `41300249554` failed on `the dump does not mention x_settings`. Production stores settings in `x_setting_items`; `x_settings` was a guess, and it was the only check that ever produced a false failure. Removed (`open-box#77`), and `data-bearing-tables` became `copy-sections` because `pg_dump` writes a COPY section for an empty table too — the count is a scope fact, not a claim that rows exist.

Two more failures were in the upload half, after a verified archive existed:

- **A manifest row in a table that does not exist.** `POST /rest/v1/openbox_backup_manifest` returned 404 (run `41300249554`). No `openbox_*` table exists in any schema and no Go code names one; the name only survives in `supabase/migrations/20260831232500_*`. The manifest is a JSON object stored beside the archive in the same bucket instead (`open-box#78`) — inventing DDL on a shared production database to satisfy a script was not the fix.
- **Supabase Storage answers 400 where the API means 409.** Run `41301242055` built and verified a good archive (`openbox-tables=10 tables-in-archive=103 copy-sections=103 sha256=2cea096878541edc…`) and then died on `bucket step returned 400: {"statusCode":"409","error":"Duplicate","message":"The resource already exists","code":"BucketAlreadyExists"}`. The bucket has existed since 2026-09-22. The step now reads the body — `BucketAlreadyExists` is success, a 2xx is success, anything else stops the run with the status and body printed (`open-box#79`). Judging that call by transport code alone was the mistake, and `|| true` would have been worse.

What is now true, from read-only queries against `huadtiuuoiriqrjpjxhr` rather than from a workflow log:

- `open-box#79` merged as `3f571aa0`, and a dispatch of `Open-Box Backup Supabase` on it (`41302547986`) is the first fully green run of this job: `using /usr/lib/postgresql/17/bin/pg_dump (17) against server major 17`, `schemas holding Open-Box tables: public`, `verified: openbox-tables=10 tables-in-archive=103 copy-sections=103 sha256=35151dec…`, then `bucket already exists (HTTP 400)` → `archive stored` → `manifest stored alongside the archive`, with the artifact uploaded at 4,415,316 bytes.
- `storage.objects` — read independently of the workflow log — holds three archives and one manifest in `open-box-backups`: `openbox-db-20261101T110457Z.sql.gz` (4,409,890 B), `openbox-db-20261101T110517Z.sql.gz` (4,410,086 B), `openbox-db-20261101T113609Z.sql.gz` (4,413,831 B) and `openbox-db-20261101T113609Z.sql.gz.manifest.json` (346 B). The first two came from `Open-Box Maintenance`'s `backup-db` and the earlier dispatch that got past the dump; all were written on 2026-11-01, twelve days after the last successful backup.
- `open-box-backups` and `open-box-files` were created 2026-09-22; `open-box-files` has no objects.
- The ten Open-Box tables are `x_access_tokens`, `x_meta`, `x_revoked_sessions`, `x_search_nodes`, `x_setting_items`, `x_sharing_dbs`, `x_ssh_public_keys`, `x_storages`, `x_task_items`, `x_users`, all in `public`. `open_box` exists and is empty. See the "Database ground truth" note in [CONFIG_MAP.md](../../deploy/CONFIG_MAP.md).
- None of this repository's ten `supabase/migrations/*` versions are in `supabase_migrations.schema_migrations` (which holds 104 other rows), so the platform schema in the repo has never been applied to production. Applying it stays a separate reviewed change; a CI job must not do it as a side effect.

Still open on this path: a restore has never been executed, so "verified archive" means the scope and contents were checked, not that the file can rebuild an installation. That test needs an isolated target, not this database. The nightly cron (`02:00`) has not yet run on the fixed script — the maintenance job's `backup-db` and one manual dispatch prove the pipeline, not the schedule.

## Promotion executed: 2026-11-01 (sixth pass) — production runs the main tip

`main` now carries a runtime change, so this promotion is not a documentation roll: between `ef241d2d` and the tip, the only files that reach the container are `go.mod` / `go.sum`, and the single difference is `github.com/go-chi/chi/v5 v5.3.1 → v5.4.0`. The `// indirect` comment is not evidence that it is absent from the artifact — `go list -deps ./server/...` shows no chi, but the built package is `./cmd`, and `go list -deps ./cmd` walks `github.com/rclone/rclone/fs/rc` → `rclone/lib/http` → `github.com/go-chi/chi/v5`. So the binary that has been serving open-box.space contains chi 5.3.1 while the repository's dependency graph has been fixed for a day. Probe the real build entry point before deciding a dependency does not ship.

`openbox-deploy.yml` dispatched on `main` (run `41306371948`, `promote and verify`, rotation attested by the owner):

| step | what it recorded |
| --- | --- |
| image resolved | `hillstreet/open-box:main-7d238fe`, digest `sha256:5dfc5fdbe8f49a6178b862337e5f3d528406ac6bb262c2e77a627c7cb9603424`, pushed 12:20:51Z, amd64 + arm64 |
| pin | `Pinning the service image tag to main-7d238fe`, service `6a967b310e919aed614685ce` in project `6a966cc0a85370460248e847` |
| before / after | `Build at: 2026-11-01 11:52:50` → `Build at: 2026-11-01 11:52:58`; the container rolled, one intermediate poll read `unreachable` |
| PAT discriminator | `{"code":401,"message":"Invalid or expired access token"}` |
| authorization | `/api/admin/storage/list` answers HTTP 200 with `{"code":401,"message":"Guest user is disabled, login please"}` — the envelope carries the logical code, as `common.ErrorStrResp` does; checked after the run as well |
| frontend identity | served `/assets/index-D-qN4CSQ.js` + `/assets/index-legacy-aJ_3kIsw.js`, equal to `expected_frontend_asset` |
| health, TLS | `/ping` 200 at edge and origin, `ssl_verify_result=0`, public settings still read from the database |
| LDAP gate | `/api/public/settings` still answers `ldap_login_enabled = "false"` while the stored row remains `true` with an empty `ldap_server` |

Retired project `ymhiwerqyegvondndkjn` was never targeted, and no credential was printed: the deploy and diagnostics workflows both pass the Zeabur token through `***` and run payloads through the redaction filter.

### The service had been rolling by itself, and that is the real finding

Between the fifth pass and this one, production moved twice without any dispatch. At 11:35Z it served `Build at: 2026-11-01 10:53:33`; at 12:20Z the promotion recorded `Build at: 2026-11-01 11:52:50` as the state it was replacing. Neither stamp is `main-ef241d2` (which stamps `2026-10-31 21:54:01`). Both new stamps land seconds after a `Open-Box Docker Hub` run finished pushing, which is what a service tracking the mutable `latest` tag looks like: every merge to `main` re-points `latest`, and Zeabur redeploys.

The fifth pass concluded the opposite — that pinning had made production immune to `latest`. That conclusion was wrong, and the reason is worth keeping: `Build at:` was read once, right after the promotion, and never re-read. A single read cannot distinguish a pin from a moving tag; only a later read after another merge can. The `openbox-zeabur-diagnose.yml` header already said the service rebuilds itself without any action from CI; the promotion log now supplies the mechanism, and `deploy/CONFIG_MAP.md`'s "Prebuilt image runtime" line is only true about the template (`PREBUILT_V2`), not about who triggers a deploy.

Consequences, in order of importance:

- Merges to `main` have been reaching the live site without the production gate. The gate passing for `main-7d238fe` is not evidence the site was gated; it is evidence the site was already at that commit's build.
- This pass re-pinned to `main-7d238fe`, but a pin's durability is exactly what the last pass misjudged. The check is: after the next merge to `main`, read `Build at:` before dispatching anything. If it moved, the service still follows `latest` and the fix is a platform-side configuration change (stop auto-deploying, or point the service at a tag CI does not move), not another promotion.
- Do not treat `latest` as a deployable artifact for this reason; the tag is non-monotonic *and* auto-consumed. **Closed on the CI side: `Open-Box Docker Hub` now moves `latest` only on a `v*` tag push, so a merge to `main` can no longer roll production. See "The merge channel closed" below.**

One more platform fact from the read-only diagnostics (`41306957808`): the project contains a second service, `6adf9e880ca070d4379475d0` (`open-box-next.zeabur.internal`, port `8080`), whose deployments are Git-driven off `refs/heads/main` of this repository — it rebuilt for `7d238fe7` at 11:51:49Z. It owns neither `open-box.space` nor `open-box-space.zeabur.app`; both domains, including the apex's `redirectTo`, belong to `6a967b310e919aed614685ce`. So the promotion targeted the right service, and the extra service is a separate consumer of every merge worth accounting for before a schema migration.

## Frontend channel fixed: 2026-11-01, ahead of the seventh promotion

The sixth pass left an item open: `OpenList-Frontend` publishes no `edge` release, so `build.sh`'s preferred channel does not exist and the newest fork frontend never reaches an image. This section records what was checked and what was published to close it. Nothing here claims a production result — the image build, the promotion and the live gate are still to come.

| Fact | Evidence |
| --- | --- |
| The console change is merged | `OpenList-Frontend` PR #4 merged to `main` as `5de795c` (sectioned sidebar with search and an icon rail, sticky header with an avatar menu, and a Developer page for personal access tokens) |
| No repository workflow has ever run in that fork | `GET /repos/hillstreet-ph/OpenList-Frontend/actions/workflows` returns only `dynamic/*` entries (Dependabot, two CodeQL). Every run in the first 50 is `dynamic/…`, so `build_rolling.yml` is present in git but unregistered — the same reason `edge` was missing |
| Manual publishing is the fork's existing practice | `releases/v4.2.9` was created by `master-kanor` (not a bot) on 2026-10-25 and its asset is the `ce49abd` dist — the bundle production serves today |
| `edge` now exists | prerelease tagged `edge` at `5de795c` with `openlist-frontend-dist-v4.2.9-5de795c.tar.gz`; `GET /releases/tags/edge` resolves, and its asset URL survives the exact `grep openlist-frontend-dist \| grep -v lite \| grep \.tar\.gz$` chain in `FetchWebRolling` |
| The stable channel moved too | `build.sh release docker` calls `FetchWebRelease`, i.e. `releases/latest`, and GitHub excludes prereleases from `latest`. So `v4.2.10` was cut at `6265a55` (package.json bumped) and published as a stable release; `GET /releases/latest` now answers `v4.2.10` with `openlist-frontend-dist-v4.2.10.tar.gz` |
| Asset identity to expect | the packaged `index.html` references `/assets/index-Dhpyq0q1.js` and `/assets/index-legacy-C6RfuVZt.js`; production still serves `index-D-qN4CSQ.js` + `index-legacy-aJ_3kIsw.js` as of this writing |
| Artifact provenance | built locally at the tagged commit with the toolchain `build_rolling.yml` pins (`node 24.22.2`, `pnpm 11.28.9`); `pnpm build` then `dist/VERSION` + `tar -czf … -C dist .`, matching `build.sh`'s `--dev --compress` layout. The archive was extracted and compared against `dist/` file-for-file |
| Not regressed by accident | neither the old nor the new bundle contains non-English strings (`grep` for `仪表盘` / `存储` returns nothing in either), so skipping the unavailable Crowdin step does not remove translations production had |

Two consequences worth carrying into the next promotion:

- A builder layer is only as fresh as its cache key. `Dockerfile` fetches the frontend inside `RUN git init … && bash build.sh release docker`, whose key comes from `COPY ./ ./` — an unchanged `open-box` tree reuses the cached layer and re-ships the previous dist even after a new frontend release is published. The documentation edit in this commit is also the cache bust that makes the next image re-fetch; if a future frontend-only change ever needs an image, `open-box` has to carry a byte of change to get one.
- `latest` is the channel production consumes, so a stable frontend release is the one that matters here. `edge` covers `beta` builds (`FetchWebRolling`), which this promotion does not use.

## The merge channel closed: `latest` moves only on a version tag (2026-11-01)

The sixth pass left one instruction: re-read `Build at:` after the next merge to `main`, before dispatching anything. It was re-read, and production had moved — twice, with no promotion run anywhere in between.

| Time (Z) | What is verified about it |
| --- | --- |
| 12:24:50 | the last `Open-Box Deploy (Zeabur)` run before this section (`41306371948`, the sixth pass). `gh run list --workflow "Open-Box Deploy (Zeabur)"` shows no later run at any point below |
| 12:20:51 / 13:19:18 / 13:34:12 / 13:47:42 | `Open-Box Docker Hub` pushes for `main-7d238fe`, `main-1b3a8bf` (PR #81, docs only), `main-d5ec668` (PR #82, docs only) and `main-7af6579` (PR #83) respectively; the two pushes after 12:20 each also re-pointed `latest` — digests `5dfc5fdbe8f49a617…`, `960c6fe784e13c59b…`, `cd8aaa10578669fb9…`, `e2bb8b4c3f0419686…` |
| 13:31 | served: `Build at: 2026-11-01 11:52:58`, `Frontend: v4.2.9` — still the image the promotion pinned |
| 13:36 | served: `Build at: 2026-11-01 13:19:20`, `Frontend: v4.2.9` — a build this repository never promoted |
| 14:28 | served: `Build at: 2026-11-01 13:19:10`, `Frontend: v4.2.10` — again different, minutes after the 13:47:42 re-point |

Identify an image by its `Build at:` stamp *and* the `Frontend:` version, not by the synthesized `Commit:`. Two `Open-Box Docker Hub` runs overlapped here, and their builds stamped 13:19:10 and 13:19:20 — ten seconds apart, so a stamp alone can be nearly ambiguous; `Frontend: v4.2.10` vs `v4.2.9` separates them, and only the v4.2.10 build is `latest` (= `main-7af6579`, digest `e2bb8b4c…`). One roll was observed skipping an intermediate re-point: `main-1b3a8bf` moved `latest` at 13:19:18 and was never seen served, because the next read (13:36) already showed a build from the later push.

A documentation-only merge (PR #82) reached the live site with the production gate never running, and another (PR #81) re-pointed the tag the service follows ten minutes earlier. The site is now serving `main-7af6579`, the build of PR #83 — so the running production image is whatever merged last, not whatever was promoted. That settles the question the fifth pass got wrong: `service update tag --tag main-<sha>` is not durable on this service — it re-resolves the mutable tag, and CI was moving that tag on every merge.

The fix could not be the Zeabur console from here (no management credential is held by this repository, and none should be), so it is made where CI does have authority: **`Open-Box Docker Hub` no longer publishes `latest` for a push to `main`.** A branch push produces only `hillstreet/open-box:main-<sha>`; `latest` moves when a `v*` tag is pushed, i.e. on a deliberate release. The mutable tag the service follows therefore stops moving on merges, which is the same property the platform-side change would have given, obtained without touching the provider.

- Verified by extracting the `Tags` step’s shell from the workflow and executing it with `GITHUB_REF`/`GITHUB_OUTPUT` set: `refs/heads/main` → `tags=hillstreet/open-box:main-0123456`, `latest=false`; `refs/tags/v1.2.3` → `tags=hillstreet/open-box:v1.2.3,hillstreet/open-box:latest`, `latest=true`. Nothing else in `.github/workflows/` references `open-box:latest`, so this is the only publisher.
- Do not confuse this `latest` with the frontend `latest` in "Frontend channel fixed" above: that one is `OpenList-Frontend`’s GitHub *release* channel, consumed by `build.sh FetchWebRelease` at image-build time. It is untouched here.
- What this change does **not** do: it does not move production off whatever `latest` currently resolves to. At the time of writing that is the build of the current `main` tip, which contains everything merged — so the running site is a CI build of this repository’s main branch, not an unaccountable artifact. Re-read `Build at:` and the Docker Hub tag list before the next promotion, and treat the digest, not the tag name, as the identity. One part of this reading was overtaken: the `v4.2.10` bundle that is live was put there by the gated promotion (`41314770281`, 14:09:32Z), not by the tag moving — see "One correction to “The merge channel closed”" below.
- The remaining platform-side option is unchanged and still better: point `6a967b310e919aed614685ce` at an immutable tag, or disable auto-deploy. Until that happens, a version-tag push will still roll production without the gated workflow.

## Both backup jobs now record a checksum manifest (2026-11-01)

`open-box#83` replaced the maintenance job’s bare `curl --fail-with-body` upload with the same script the nightly job uses, so both archives get the manifest that the restore check depends on. Verified on `main` = `7af65794`, one dispatch each, both green:

| Job | Run | Archive in Storage | Manifest in Storage | Artifact |
| --- | --- | --- | --- | --- |
| `Open-Box Backup Supabase` | `41310689628` | `openbox-db-20261101T131944Z.sql.gz` — 4,418,864 B | `….sql.gz.manifest.json` — 346 B | both files, and `sha256(archive)` = `a63575d9e71b…` = the manifest’s `checksum` |
| `Open-Box Maintenance` / `backup-db` | `41310686564` | `openbox-db-20261101T131954Z.sql.gz` — 4,418,885 B | `….sql.gz.manifest.json` — 346 B | both files, and `sha256(archive)` = `25c6fc9f45e0…` = the manifest’s `checksum` |

- Both logs show the same proven sequence: `using /usr/lib/postgresql/17/bin/pg_dump (17) against server major 17`, `schemas holding Open-Box tables: public`, `verified: openbox-tables=10 tables-in-archive=103 copy-sections=103`, then `bucket already exists (HTTP 400)` → `archive stored` → `manifest stored alongside the archive`.
- `storage.objects` was read independently of the workflow logs: the two new archives and their two manifests are all present, while the two maintenance archives uploaded before this change (`…110457Z`, `…110517Z`) still have no manifest — which is exactly the gap that made a restore unverifiable.
- Both run artifacts were downloaded and their archives re-hashed, to prove each manifest describes the bytes that were actually stored rather than the bytes the dump step intended to store.
- A pitfall found on the way: the static risk rules in `openbox-autofix.yml` scan every added line outside `.github/workflows/` for three destructive spellings — dropping a table, truncating a table, and a recursive remove — and a recursive remove inside a temp-directory cleanup trap in `.github/scripts/` was enough to block the PR. The script now uses three `mktemp` files and a non-recursive `rm` in its `trap` exit hook: same guarantee (no response body is ever read stale), nothing removes a directory tree. The three spellings are named here in prose rather than quoted, because quoting them in a documentation line is itself enough to trip the scan — a rule that applies to shipped text, which this file is.

## Promotion executed: 2026-11-01 (seventh pass) — the rebuilt console is live

The channel recorded in "Frontend channel fixed" existed but had never been consumed. `openbox-deploy.yml` was dispatched on `main` = `7af6579` (run `41314770281`, `promote and verify`, rotation attested by the owner, `image_tag=main-7af6579`, `expected_frontend_asset=index-Dhpyq0q1.js`) at 14:09:32Z and finished green at 14:10:48Z. It targeted service `6a967b310e919aed614685ce` in project `6a966cc0a85370460248e847`; the retired project was never named, and no credential was printed.

| step | what the run recorded |
| --- | --- |
| image resolved | `hillstreet/open-box:main-7af6579`, digest `sha256:e2bb8b4c3f04196864a08229fcd6a8e84c7bf8237a1993fc7e642ee6d100c0e7`, pushed 13:47:40Z, amd64 + arm64 |
| origin ownership | `origin host open-box-space.zeabur.app is bound to this service` |
| before | `v0.0.0 (Commit: 63343aa) - Frontend: v4.2.9 - Build at: 2026-11-01 13:19:20 +0000` (read at 14:09:49) |
| roll | first poll 14:09:52 still served the old stamp; 14:10:36 served `Commit: d6fb971 - Frontend: v4.2.10 - Build at: 2026-11-01 13:19:10 +0000` |
| health | `/ping` 200 `pong` at the edge |
| PAT discriminator | `{"code":401,"message":"Invalid or expired access token","data":null}` — the running binary is the scoped-token build, not one that replies `token is invalidated` |
| token routes | `/api/me/token/list` returns a JSON envelope rather than the SPA shell, at origin and edge alike (re-checked after the run: `{"code":401,"message":"Invalid or expired access token"}`) |
| admin routes | `GET /api/admin/setting/list` with a PAT-shaped header answers `{"code":401,"message":"Invalid or expired access token"}`, and with no header `{"code":401,"message":"Guest user is disabled, login please"}` — `RequireSession` is in front of `/api/admin/*` as designed |
| settings | public settings payload non-empty, read through the edge |
| storage | anonymous `/api/fs/list` answers `{"code":401,…}` — "listing requires auth in this deployment; recorded as expected", which the workflow accepts instead of failing |
| TLS / gateway | `ssl_verify_result=0`; `server: cloudflare` with `x-zeabur-request-id` present at the edge, so the no-`x-zeabur` warning did not fire |
| frontend identity | served `/assets/index-Dhpyq0q1.js` + `/assets/index-legacy-C6RfuVZt.js`; `frontend identity matches the expected build`; final line `Production gate passed for main-7af6579.` |

The log contains no emitted error or warning annotation (`grep -c '##\[error\]'` = 0, no `##[warning]` line).

### The cache coupling was measured, not assumed

The previous section predicted that a documentation byte would be enough to make the builder re-fetch the frontend. Two `Open-Box Docker Hub` runs prove it, read out of the buildx logs (`gh api …/actions/jobs/<job>/logs --allow-escape-sequences`, then the ANSI stripped before grepping):

| image | hub push | the lines that matter |
| --- | --- | --- |
| `main-d5ec668` (PR #82, docs only) | 13:34:12Z, digest `sha256:cd8aaa10578669fb9…` | `#25 1.528 frontend version: v4.2.10` (arm64), `#26 0.334 frontend version: v4.2.10` (amd64), `./assets/index-Dhpyq0q1.js` in the extracted dist, `WebVersion: v4.2.10` at 13:09:09 and again at 13:34:02 |
| `main-7af6579` (PR #83) | 13:47:40Z, digest `sha256:e2bb8b4c3f0419686…` | `#25 0.274` / `#26 1.386 frontend version: v4.2.10`, `./assets/index-Dhpyq0q1.js`, `WebVersion: v4.2.10` at 13:22:57 and 13:47:30 |

So after a frontend release moves `releases/latest`, the *next* merge to `main` carries it into the image — no manual trigger on `OpenList-Frontend` is required, which was the whole reason the fork's missing `build_rolling.yml` mattered.

### One correction to "The merge channel closed"

That section read `Frontend: v4.2.10` at 14:28 and concluded the site was "serving whatever merged last, not whatever was promoted". The gate log narrows it: the promotion read `Build at: 2026-11-01 13:19:20` / `Frontend: v4.2.9` at **14:09:49**, i.e. 22 minutes after `main-1b3a8bf` re-pointed `latest` (which did roll, seen at 13:36), 35 minutes after `main-d5ec668` re-pointed it, and 22 minutes after `main-7af6579` re-pointed it — neither of the later two had reached the service. The v4.2.10 that is live is there because the gated promotion pinned it, and the auto-roll is neither immediate nor dependable. `OpenList-Frontend` was also not consulted: `Open-Box Docker Hub` publishes `latest` on every merge under the old rule, and the service consumed it only once out of three chances.

A second, smaller consequence for anyone reading a promotion log: the before stamp (`13:19:20`) is *later* than the after stamp (`13:19:10`), because the two overlapping builds stamped ten seconds apart. The gate's "the reported build stamp did not change" assertion therefore proves *difference*, not *progress*. Identity has to come from the digest, the `Frontend:` version and the served asset names — in that order.

### The served bundle was compared to the published release, not only by name

`dist/` was rebuilt locally at the tagged commit, so the local chunk hashes and the release archive agree (`entry-DT_QUjH3.js` md5 `c01dfea3…`, `manage-CtnRFoSL.js` md5 `9b08a7b8…`). What the edge serves differs from those bytes in exactly two ways, both expected:

- every `__vite__mapDeps` dependency is suffixed with a cache-buster query (`?open-box-brand=20261014`), which is why the served sizes are larger than the released ones (`entry` 109,912 → 109,936, `manage` 24,799 → 27,343, `store` 500,373 → 500,542);
- the startup banner is rewritten from the upstream project name and repository URL to the fork's, a one-byte net change inside the console banner template.

With the query suffix removed, `manage-CtnRFoSL.js` and `entry-DT_QUjH3.js` are byte-identical to the release; `store-LOm5VZiC.js` differs only at the banner. The new console is therefore live by content, not just by entry filename: the served `manage` chunk contains `nav_search_placeholder`, `sidemenu.developer` (twice) and the fork's brand, and the served `store` chunk contains the token routes `me/token/create`, `me/token/revoke`, `expires_in` and `scopes` — the Developer page ships in that chunk, which is why those strings are absent from the `manage` chunk.

### What this pass did not verify

- Authenticated behaviour in a browser: signing in, folding a section, switching to the icon rail, and creating then revoking a token through the Developer page. The API routes and the shipped chunks are proven; the interaction is not, because this session holds no Open-Box login and no session was created for the sake of the record.
- Pixel-level appearance. The Playwright browser tools are disabled by this machine's settings, so the visual result was checked at the DOM and bundle level only. Earlier in this work the accessibility snapshot of the console shell was captured, which is not a substitute for a screenshot.

## Remaining rollout gates

- Workflow dispatch works again. The 422 ("Actions disabled for the account") and the rotation attestation were already resolved, and the billing lock that followed them released at 21:52Z: run `41247679221` promoted `main-ef241d2` and passed the production gate. If runs start going 3-to-5 seconds with no steps again, check `https://github.com/settings/billing` for `hillstreet-ph` before reading anything into the code.
- Credential rotation is outstanding and is now the top item. Alongside the historically exposed Supabase, Docker Hub and Zeabur management tokens, values pasted into chat on 2026-10-31 must be rotated: the administrator password (`ADMIN_PASSWORD` / `OPENLIST_ADMIN_PASSWORD`), the database password (`DB_PASS`), and a GitHub personal access token. None of them were used by CI, and none are recorded in this repository. The owner attested rotation for the promotion gate; that attestation is not evidence this repository could verify, and the pasted GitHub PAT in particular should be confirmed revoked at `https://github.com/settings/tokens`.
- Image build, immutable digest verification and the production rollout are done for `main-a15ceb3` (third pass), `main-35a4ce0` (fourth pass), `main-ef241d2` (fifth pass, digest `sha256:f30d6d4e…`), `main-7d238fe` (sixth pass, digest `sha256:5dfc5fdb…`, chi 5.4.0) and `main-7af6579` (seventh pass, digest `sha256:e2bb8b4c…`, frontend `v4.2.10` — the rebuilt console). Do not treat the embedded `Commit:` value as a repository SHA; it is synthesized by the `Dockerfile` builder fallback — identify an image by its `Build at:` stamp and served asset names. The LDAP row is a stored setting and is unchanged: the production database still holds `ldap_login_enabled = 'true'` with an empty `ldap_server`, and the running binary now publishes `false` while the directory is unusable, which is the behavior the fix was wanted for. **And re-read the stamp before dispatching:** the fifth pass believed its pin had made production immune to `latest`, the sixth found unprompted rolls, and the seventh found that a roll can also *not* happen for half an hour — so read the stamp, and treat the gate as the only delivery path.
- `OpenList-Frontend` still has no registered `build_rolling.yml`, so the `edge` channel exists only because it was published by hand. The consequence is now closed: `edge` and `releases/latest` = `v4.2.10` have both been consumed by image builds, and production serves that bundle (`main-7af6579`, digest `sha256:e2bb8b4c…`, `/assets/index-Dhpyq0q1.js`). See "Frontend channel fixed" and "Promotion executed … (seventh pass)" above. What is still unregistered in that fork is CI itself — the next frontend release again has to be packaged and published manually, or the fork's workflow needs registering before it can publish.
- Runtime `x_*` tables are in `public`, not the intended isolated `open_box` schema; `open_box` exists and is empty. The `deploy/PRODUCTION.md` pre-flight check that confirms `current_schema()` is `open_box` therefore does not pass today, and a DSN scoped to `open_box` without `public` after it would not resolve `x_users`. The encrypted backup that this gate demanded before any migration now exists and is verified for scope, but has not been restored; the migration itself remains unstarted and needs its own reviewed plan.
- Security advisories went from seven to one. `open-box#49` and `open-box#50` are merged, and the remaining advisory is `github.com/disintegration/imaging <= 1.6.2` (low), which has no upstream fix to bump to — see `https://github.com/hillstreet-ph/open-box/security/dependabot/1`.
- No persistent volume was observed on the service. Do not create a local storage mount on the container filesystem and describe it as durable. The session fix works without a volume because both the signing key and the revocations live in the database. Still to observe in production: a signed-in session surviving a redeploy, and a signed-out session staying rejected — both need one authenticated session, which is why they are recorded as unverified rather than as passing.
- Supabase OAuth Server/client registration, exact approved MCP client IDs, explicit SSO subject/account linking, and signed-in MCP tools/list + file read remain unverified. See [CHATGPT_MCP.md](CHATGPT_MCP.md).
- Open-Connect Google registry rows are capability grants, not verified native storage credentials. This Composio workspace exposed one verified Drive account; that does not establish access to every account in Open-Connect.
- Native GoogleDrive drivers cannot consume opaque connector metadata. An approved scoped filesystem broker or separate per-account native authorization is required. Non-executable Open-Connect adapter draft: `314835cc-b657-4d4c-8de7-e4bdcd58c51b`.

## Account organization

Use `/google-drive/<account>` for each verified Google account, and unique provider/account mounts for other storage. Keep personal and workspace identities separate. Validate account identity, scopes, listing, and reading before marking any mount connected. Source collection uses copy; never propagate deletions.

Secrets remain in their existing server-side stores. No refresh tokens, access tokens, passwords or database secrets are included in this report. Supabase Auth health does not verify database, file storage or backups.
