# Open-Box Agent Assistant

Agent Assistant is an internal file helper in the lower-left dock beside Integrations. It uses Workers AI to propose one validated operation and the current user's Open-Box session to execute it. There is no administrator credential in the widget or AI prompt.

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

Verified on 2026-10-10: GitHub App `box-open` belongs to `master-kanor`, its client ID matches native Open-Box settings, and native administrator `admin` is linked to GitHub user ID `297973909`. SSO is disabled and the client-secret setting is empty. This change does not claim SSO is enabled or tested.

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
2. Generate an OAuth client secret in GitHub's secure settings. Store it only in protected native SSO configuration or an approved secret vault. An App private key is a separate credential and cannot substitute for the client secret. Do not paste secrets into chat, issues, commits or documentation.
3. Keep password sign-in available. Inspect the native SSO backend's state/PKCE protection before exposing production login; the current native GitHub implementation needs this review. Do not switch on SSO simply to display a successful status.
4. With the complete configuration, test an authorized administrator in a separate browser session: callback success, unchanged linked user, no accidental new administrator, denied unlinked user when auto-registration is off, and password-login fallback. Record sanitized evidence.

Supabase GitHub OAuth is a separate flow and uses the project's `/auth/v1/callback`. A native mount, Composio connection, and OpenConnect connection are also distinct grants. Verify each account's own listing and read access before marking it connected. Provider consent is required for Google, Microsoft, Dropbox and other providers.

## Validation and release

Run `npm test` in `deploy/cloudflare`. Tests cover unauthenticated and disabled/guest sessions, foreign origins, invalid paths, model-proposed unsupported operations, denied native permissions, redacted file results, write confirmation and queued tasks.

Review the issue-scoped PR and required checks before merge. Verify an immutable gateway version in staging before promotion. Retain the current production version for rollback. The existing backend Docker delivery is independently blocked by GitHub Actions account/organization availability and is not repaired by a gateway-only change. Do not deploy a mutable image tag to bypass it.

For production smoke checks, verify the dock on a phone-sized viewport, sign-in denial, a permitted folder listing, a proposed folder creation cancelled without a write, and one confirmed operation on a temporary authorized path. Check native Tasks for asynchronous copies. Preserve legal upstream notices while using Open-Box in user-facing branding.
