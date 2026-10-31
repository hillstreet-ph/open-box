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
| Running production binary | `/api/public/settings` reports `Build at: 2026-10-31 08:50:39 +0000`, the build stamp of the `main-108c1cb` image (PR #59 docs, before the token merge) |
| PAT behaviour probe | `POST /api/fs/list` with bearer `obk_*` returns `{"code":401,"message":"token is invalidated"}` at both the origin and `open-box.space`; the token-aware build returns `Invalid or expired access token`. `/api/me/token/list` still falls through to the SPA HTML |
| Auto-deploy | Neither the 09:19 nor the 10:53 `:latest` push rolled the service within an hour, so promotion needs an explicit Zeabur action |
| Frontend | `FRONTEND_REPO` now points at `hillstreet-ph/OpenList-Frontend`, whose first release `v4.2.9` publishes the `ce49abd` dist archive (Home and Profile moved into the `/manage` header). Earlier images used the upstream `OpenListTeam/OpenList-Frontend` release, so the merged header change was not in any built image before this |

Blocker, stated plainly: this environment has no Zeabur write access — no CLI session (`zeabur auth status` reports not logged in), no dashboard login in the connected browser, and the `ZEABUR_API_TOKEN`/`ZEABUR_TOKEN` values exist only as write-only GitHub Actions secrets, which the repository gates on rotation (see [PLATFORM_BACKEND.md](../PLATFORM_BACKEND.md)). `.github/workflows/openbox-deploy.yml` performs the promotion and this gate; it is dispatched by a human who confirms rotation.

## Remaining rollout gates

- GitHub Actions workflow dispatch returned 422: Actions disabled for the user/organization. Repository settings already report `enabled=true`; changing the repository permission policy does not resolve this account-level gate.
- Backend image build, immutable digest verification and staging rollout are still required. The current Zeabur image label and embedded binary commit differ; do not claim the tag is proof of deployed source.
- Runtime `x_*` tables are in `public`, not the intended isolated `open_box` schema. Verify an encrypted backup and reversible migration before moving tables or changing search_path.
- No persistent volume was observed on the service. Do not create a local storage mount on the container filesystem and describe it as durable.
- Supabase OAuth Server/client registration, exact approved MCP client IDs, explicit SSO subject/account linking, and signed-in MCP tools/list + file read remain unverified. See [CHATGPT_MCP.md](CHATGPT_MCP.md).
- Open-Connect Google registry rows are capability grants, not verified native storage credentials. This Composio workspace exposed one verified Drive account; that does not establish access to every account in Open-Connect.
- Native GoogleDrive drivers cannot consume opaque connector metadata. An approved scoped filesystem broker or separate per-account native authorization is required. Non-executable Open-Connect adapter draft: `314835cc-b657-4d4c-8de7-e4bdcd58c51b`.

## Account organization

Use `/google-drive/<account>` for each verified Google account, and unique provider/account mounts for other storage. Keep personal and workspace identities separate. Validate account identity, scopes, listing, and reading before marking any mount connected. Source collection uses copy; never propagate deletions.

Secrets remain in their existing server-side stores. No refresh tokens, access tokens, passwords or database secrets are included in this report. Supabase Auth health does not verify database, file storage or backups.
