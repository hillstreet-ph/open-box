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


## Remaining rollout gates

- Workflow dispatch is available again. Run `41201462506` dispatched `openbox-deploy.yml` successfully and stopped at the rotation precondition, so the earlier 422 ("Actions disabled for the account") gate no longer applies. The remaining gate is the human rotation attestation, not platform access.
- Credential rotation is outstanding and is now the top item. Alongside the historically exposed Supabase, Docker Hub and Zeabur management tokens, values pasted into chat on 2026-10-31 must be rotated: the administrator password (`ADMIN_PASSWORD` / `OPENLIST_ADMIN_PASSWORD`), the database password (`DB_PASS`), and a GitHub personal access token. None of them were used by CI, and none are recorded in this repository.
- Image build, immutable digest verification and the production rollout are done for `main-a15ceb3` (see the third-pass section). Do not treat the embedded `Commit:` value as a repository SHA; it is synthesized by the `Dockerfile` builder fallback.
- Runtime `x_*` tables are in `public`, not the intended isolated `open_box` schema. Verify an encrypted backup and reversible migration before moving tables or changing search_path.
- No persistent volume was observed on the service. Do not create a local storage mount on the container filesystem and describe it as durable.
- Supabase OAuth Server/client registration, exact approved MCP client IDs, explicit SSO subject/account linking, and signed-in MCP tools/list + file read remain unverified. See [CHATGPT_MCP.md](CHATGPT_MCP.md).
- Open-Connect Google registry rows are capability grants, not verified native storage credentials. This Composio workspace exposed one verified Drive account; that does not establish access to every account in Open-Connect.
- Native GoogleDrive drivers cannot consume opaque connector metadata. An approved scoped filesystem broker or separate per-account native authorization is required. Non-executable Open-Connect adapter draft: `314835cc-b657-4d4c-8de7-e4bdcd58c51b`.

## Account organization

Use `/google-drive/<account>` for each verified Google account, and unique provider/account mounts for other storage. Keep personal and workspace identities separate. Validate account identity, scopes, listing, and reading before marking any mount connected. Source collection uses copy; never propagate deletions.

Secrets remain in their existing server-side stores. No refresh tokens, access tokens, passwords or database secrets are included in this report. Supabase Auth health does not verify database, file storage or backups.
