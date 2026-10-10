# Open-Box Agent Assistant

Exact commands `list /path`, `get /path`, `mkdir /path` and `create /path` preserve the supplied absolute path without model inference. Quote paths containing spaces. The assistant still verifies the native session, validates paths and asks for confirmation before folder creation; planning never writes files. Other phrasing uses Workers AI and remains a proposal to review.

Agent Assistant is an internal file helper in the lower-left dock. Integrations appears directly below Storages in the management sidebar and any rendered mobile navigation drawer, using the native menu styling. The dock retains an Integrations fallback on file/login pages and while the native menu is loading. Navigation remounts do not create duplicate links. It uses Workers AI to propose one validated operation and the current user's Open-Box session to execute it. There is no administrator credential in the widget or AI prompt.

## Supported operations

| Operation     | Behavior                                                                         |
| ------------- | -------------------------------------------------------------------------------- |
| List folder   | Returns up to 100 entries and total count; no file contents                      |
| File details  | Returns name, size, directory flag and modification date; no signed download URL |
| Create folder | Shows exact path and requires Execute change                                     |
| Rename        | Shows exact path and new name; never overwrites                                  |
| Copy          | Shows source, destination and at most 20 names; reports queued tasks accurately  |

Deletion, moving, permission changes, administrator settings, secrets, shell execution and arbitrary external requests are excluded. Requests outside the allowlist produce instructions or a rejected plan. Filesystem permissions remain enforced by the native Open-Box API for each operation. Public guests and disabled users cannot use the assistant.

The widget reads the same raw localStorage `token` used by the upstream frontend. Its requests use same-origin Authorization headers. A changed sign-in clears the pending action and conversation. User text and model output are rendered as text, never HTML. An ambiguous write failure is never retried automatically.

## Gateway routes

| Route                                 | Method | Purpose                                                |
| ------------------------------------- | ------ | ------------------------------------------------------ |
| `/open-box-assistant.js`              | GET    | Static widget, injected into proxied application HTML  |
| `/api/open-box/assistant/session`     | GET    | Validate native sign-in and report capabilities        |
| `/api/open-box/assistant/chat`        | POST   | Propose one allowlisted action from a prompt           |
| `/api/open-box/assistant/execute`     | POST   | Validate action and forward it with the user's session |
| `/settings/integrations/google-drive` | GET    | Open-Box Google Drive setup guide                      |
| `/settings/integrations/dropbox`      | GET    | Open-Box Dropbox setup guide                           |
| `/settings/integrations/onedrive`     | GET    | Open-Box OneDrive setup guide                          |

Requires existing AI and ORIGIN_URL bindings. Assistant requests always authenticate against `/api/me`, including when the gateway's public file listing is enabled. API responses are not cached. No new database schema is required.

## GitHub SSO deployment checklist

Rechecked on 2026-10-10: the configured client ID is `Iv23lipQrjINz73M68vL`, and native administrator `admin` remains linked to GitHub user ID `297973909`. A client secret is present in protected settings. Production SSO login, automatic registration and compatibility mode were switched off on 2026-10-10 while the native callback security patch in issue #45 is validated. This is configuration evidence, not proof of callback success or a verified login. The gateway reports disabled SSO as Action required; an enabled configuration remains Configured until an authorized end-to-end check is recorded. Do not retrieve or publish the stored secret.

| Setting                | Intended value                                                      |
| ---------------------- | ------------------------------------------------------------------- |
| Application            | `box-open` (GitHub App ID `4658661`)                                |
| Homepage               | `https://open-box.space`                                            |
| Platform               | `Github`                                                            |
| Client ID              | `Iv23lipQrjINz73M68vL`                                              |
| Compatibility mode     | Off                                                                 |
| Sign-in callback       | `https://open-box.space/api/auth/sso_callback?method=sso_get_token` |
| Account-link callback  | `https://open-box.space/api/auth/sso_callback?method=get_sso_id`    |
| Automatic registration | Off                                                                 |

1. The owner opens [GitHub App settings](https://github.com/settings/apps/box-open) and registers both native callback URLs above.
2. Rotate the existing OAuth client secret in GitHub's secure settings because it was visible in the supplied screenshots. The 2026-10-10 protected setting check confirmed only that a nonempty value is stored; it did not verify validity or complete rotation. Store the replacement only in protected native SSO configuration or an approved secret vault. An App private key is a separate credential and cannot substitute for the client secret. Do not paste secrets into chat, issues, commits or documentation.
3. Keep password sign-in available. Build and stage the protected native GitHub handler before exposing production login; see issue #45 for browser-bound state, PKCE and replay protection. Rotate the OAuth client secret exposed in the supplied screenshots through GitHub's secure settings before enabling login. Do not switch on SSO simply to display a successful status.
4. With the complete configuration, test an authorized administrator in a separate browser session: callback success, unchanged linked user, no accidental new administrator, denied unlinked user when auto-registration is off, and password-login fallback. Record sanitized evidence.

Supabase GitHub OAuth is a separate flow and uses the project's `/auth/v1/callback`. The shared `huadtiuuoiriqrjpjxhr` project uses `https://open-connect.site` as its Site URL. Preserve that URL and its existing redirects; Open-Box needs an explicitly reviewed consent routing plan rather than replacing shared Auth configuration. Native GitHub numeric IDs and Supabase UUID subjects are different identities, so do not replace the administrator's existing `sso_id` to enable MCP. A native mount, Composio connection, and OpenConnect connection are also distinct grants. Verify each account's own listing and read access before marking it connected. Provider consent is required for Google, Microsoft, Dropbox and other providers.

## Provider and runtime mapping

| Provider     | Existing target                                                        | Verified evidence and remaining boundary                                                                     |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GitHub       | `hillstreet-ph/open-box`, `main`, PR #44                               | Repository read works; approving review and exact-head checks remain release gates                           |
| Cloudflare   | `open-box-gateway`, zone `open-box.space`                              | Account, route, current deployment and candidate read work                                                   |
| Zeabur       | Project `6a966cc0a85370460248e847`, service `6a967b310e919aed614685ce` | Runtime RUNNING; new backend source still requires a verified image build                                    |
| Docker Hub   | `hillstreet/open-box`                                                  | Repository and latest multi-architecture digest read work; selected connector reports read=true, write=false |
| Supabase     | `huadtiuuoiriqrjpjxhr`                                                 | Active healthy; one native `/Workspace` Local mount; shared OAuth rollout is separate                        |
| Sentry       | `hillstreet/open-box`                                                  | Project read works; no unresolved issues in the checked 24-hour window, which does not prove SDK ingestion   |
| Open-Connect | Existing personal gateway                                              | Auto and discovery work; no native Open-Box connection returned by provider inspection                       |

The assistant uses the existing Workers AI binding. Binding presence is reported as Configured; only a signed-in model execution proves that operation. Keep provider tokens and native account credentials in their existing protected stores. Mobile remote-tool access is separate from installing a desktop-only MCP package.

## Validation and release

Run `npm test` in `deploy/cloudflare`. Tests cover unauthenticated and disabled/guest sessions, foreign origins, invalid paths, model-proposed unsupported operations, denied native permissions, redacted file results, write confirmation and queued tasks.

Review the issue-scoped PR and required checks before merge. Verify an immutable gateway version in staging before promotion. Retain the current production version for rollback. The existing backend Docker delivery is independently blocked by GitHub Actions account/organization availability and is not repaired by a gateway-only change. Do not deploy a mutable image tag to bypass it.

For production smoke checks, verify the dock on a phone-sized viewport, sign-in denial, a permitted folder listing, a proposed folder creation cancelled without a write, and one confirmed operation on a temporary authorized path. Check native Tasks for asynchronous copies. Preserve legal upstream notices while using Open-Box in user-facing branding.
