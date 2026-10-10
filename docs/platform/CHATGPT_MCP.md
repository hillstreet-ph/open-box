# Connect ChatGPT to Open-Box with MCP

Open-Box exposes its existing read-only file tools through the MCP endpoint at `/mcp`. Supabase Auth OAuth 2.1 can authenticate a ChatGPT custom connector, while Open-Box maps the verified Supabase user subject to an existing Open-Box account. No Open-Box account is created automatically.

## Requirements

- A deployed Open-Box backend and Cloudflare gateway using the same public site URL.
- Supabase Auth OAuth Server enabled for the project.
- An existing Open-Box account explicitly linked to the matching Supabase Auth user UUID in the Open-Box user `sso_id` field.
- ChatGPT custom connectors enabled for the account or workspace.

## Configure Supabase Auth

The existing shared project `huadtiuuoiriqrjpjxhr` has Site URL `https://open-connect.site`. Preserve that URL and its existing redirects. Before enabling the OAuth server, review consent routing for both applications: a relative authorization path resolves under the shared Site URL and must route authorized Open-Box requests correctly. A dedicated Auth project is another deployment choice, but do not create or migrate one implicitly. Add the Open-Box consent URL only after that routing plan is verified:

```
https://open-box.space/oauth/consent
```

After staging and verifying the shared consent routing plan, configure **Authentication → OAuth Server** with its reviewed authorization path and Dynamic Client Registration policy so ChatGPT can register its OAuth client. The OAuth server and Dynamic Client Registration were disabled on 2026-10-10; the public metadata alone does not prove readiness. Before rollout, verify the provider discovery metadata advertises refresh-token support (`offline_access` or the provider equivalent) and that authorization grants issue refresh tokens, as ChatGPT needs refresh support for long-lived connections. Use asymmetric signing keys for new projects; review key migration guidance before changing signing keys on a project with existing sessions.

The Cloudflare gateway serves the consent screen at `/oauth/consent`. It requires `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. GitHub sign-in must already be enabled in Supabase if users need to sign in from this screen.

## Configure the Open-Box backend

Set these backend environment variables in Zeabur (use the project URL already configured in Supabase; do not put the database password or service-role key in this integration):

```env
MCP_ENABLE=true
MCP_OAUTH_ISSUER=https://<project-ref>.supabase.co/auth/v1
MCP_OAUTH_AUDIENCE=authenticated
MCP_OAUTH_ALLOWED_CLIENT_IDS=<approved-chatgpt-oauth-client-id>
SITE_URL=https://open-box.space
```

After ChatGPT registers its OAuth client, approve that exact client ID in `MCP_OAUTH_ALLOWED_CLIENT_IDS` (comma-separated for multiple approved clients). An empty allow-list denies all Supabase OAuth clients. A token from another OAuth application in the same Supabase project does not grant MCP access.

Keep the legacy admin token private. When an OAuth issuer is configured, MCP routes accept verified Supabase OAuth access tokens and valid Open-Box sessions; Supabase users must be linked to an enabled, non-guest Open-Box user. Linking should be done by an administrator using the Supabase Auth user UUID on an explicitly authorized Open-Box account. The existing administrator uses native GitHub numeric ID `297973909`; do not overwrite that link with a Supabase UUID. Use a separate authorized least-privilege account or implement a reviewed multi-identity mapping first. Do not link by email alone.

Check the public resource metadata endpoint after deployment:

```
curl -i https://open-box.space/.well-known/oauth-protected-resource/mcp
```

It should return a resource of `https://open-box.space/mcp` and list the Supabase issuer. With no token, `GET https://open-box.space/mcp` should return `401` and a `WWW-Authenticate` header pointing to that metadata endpoint.

## Add the connector in ChatGPT

In ChatGPT web, an eligible account or workspace admin can enable developer mode and create a custom app from **Workspace settings → Apps → Create** (or **Settings → Apps → Create**, depending on the workspace). Add a custom connector with MCP server URL:

```
https://open-box.space/mcp
```

Choose OAuth when prompted and complete the Supabase sign-in and consent flow. Scan the tools and test listing tools and reading a file in an account that has been explicitly linked. ChatGPT full MCP app creation is currently available to eligible Business, Enterprise, and Edu workspaces; Pro supports read/fetch MCP access in developer mode. The available Open-Box MCP tools are read-only; this integration does not grant file write/delete access.

## Use Open-Box from an AI agent

Any external MCP-capable agent can connect to the same `/mcp` endpoint using OAuth 2.1 discovery and the protected-resource metadata response. For OpenAI Agents SDK, configure a remote MCP tool with the endpoint and OAuth provider credentials/flow appropriate to the application. Do not embed user access tokens in source code or shared server environment variables. The agent's user must authenticate and have a linked Open-Box account.

## Troubleshooting

- `404` from metadata: verify `MCP_ENABLE=true` and `MCP_OAUTH_ISSUER` are set on the backend.
- `401` without a challenge: verify issuer configuration and that the deployed backend includes MCP OAuth support.
- `401` after successful Supabase sign-in: verify the token issuer and audience, Dynamic Client Registration, and exact matching Open-Box `sso_id`.
- Consent page configuration error: check Cloudflare `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, plus Supabase's authorization path and redirect allow-list.
- MCP works directly but not behind Cloudflare: ensure `AUTH_REQUIRED` does not intercept `/mcp`, `/mcp/*`, or `/.well-known/oauth-protected-resource/mcp`; the Worker must forward the bearer header to the backend.
