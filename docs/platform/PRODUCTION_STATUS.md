# Open-Box production status

Verified 2026-10-10. Public application: https://open-box.space.

## Verified deployment

| Component | Evidence |
| --- | --- |
| Cloudflare gateway | `open-box-gateway`, account `c0e6bd9a7249856cb8497e7fe340e7ce` |
| Tested branding version | `173a3b01-c790-410f-8753-5b9ae800b9dc` |
| Branding deployment | `2697475f-25c5-47f1-b63a-02dee7b5020d`, 100% traffic |
| Zeabur | Project `6a966cc0a85370460248e847`, service `6a967b310e919aed614685ce`, running |
| Origin | https://open-box-space.zeabur.app |
| Runtime version | Backend commit `a879c97`, frontend v4.2.6; older than current repository |
| Supabase | `huadtiuuoiriqrjpjxhr`; `public.x_*` tables present |
| Storage mounts | Zero, confirmed through administrator API and database |

Root/admin/nested application HTML, branded About attribution, SVG manifest and frontend cache versioning passed exact-version preview checks before deployment. The live browser confirms `Home | Open-Box` and `Powered by Open-Box`. Stored HTML/downloads/partial responses retain their original bytes. Upstream protocol identifiers and AGPL attribution remain intact.

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
