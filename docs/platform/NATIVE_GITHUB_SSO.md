# Protected native GitHub sign-in

The GitHub handler requires HTTPS, popup mode (SSO compatibility mode off), browser-bound state, and S256 PKCE. Callbacks consume their five-minute state once before contacting GitHub; a different browser, changed client/method/callback, expiry, or replay is rejected. Token exchange has a ten-second timeout and no automatic retry. Successful responses use JSON-escaped messages restricted to the canonical Open-Box origin; tokens are never placed in redirect URLs. Disabled and guest accounts cannot receive native GitHub SSO sessions.

## Deployment settings

Keep password sign-in available. In the `box-open` GitHub App settings register both callbacks:

- `https://open-box.space/api/auth/sso_callback?method=sso_get_token`
- `https://open-box.space/api/auth/sso_callback?method=get_sso_id`

Configure platform `Github`, the App's OAuth client ID and client secret through protected settings. App private keys are different credentials. The username key, organization, application and endpoint fields are not used by the GitHub provider; changing them does not repair GitHub callbacks. Rotate the client secret exposed in the supplied screenshots through GitHub's secure credential interface, then update the protected native setting. Do not copy the secret into source, issues or logs.

On 2026-10-10 production SSO login, automatic registration and compatibility mode were switched off while this patch is validated. The existing native administrator remains linked to numeric GitHub user ID `297973909`. Do not replace it with a Supabase UUID. Supabase MCP OAuth is a separate identity flow; preserve the shared project's Open-Connect Site URL.

State is held in process memory. A restart rejects in-flight sign-ins. Multiple replicas must route authorization and callback to the same instance; use a shared atomic state store before removing that constraint.

## Release verification

Run `go test -p 1 ./server/handles ./server/mcp ./server/static`. Review and build the exact approved commit into an immutable image, then stage it before production promotion. Local provider mocks prove validation and exchange behavior, not real GitHub authorization. In staging verify an authorized linked user, both popup callbacks, unlinked and disabled-user denial with automatic registration off, expiry/replay rejection, and password fallback. Only then enable production SSO.
