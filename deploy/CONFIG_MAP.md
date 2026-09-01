# Open-Box configuration map

Canonical domain: `https://open-box.space`

Never commit secret values. Store secrets only in provider secret managers.

## Topology

`open-box.space` → Cloudflare Worker `open-box-gateway` → Zeabur `Open-Box` → Supabase Postgres / Storage / Auth / Edge Functions; files also on Cloudflare R2.

## GitHub (`hillstreet-ph/open-box`)

| Kind | Name | Purpose |
|------|------|---------|
| Actions secret | `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | Publish `openclose8/open-box` |
| Actions secret | `ZEABUR_API_TOKEN` | Optional deploy automation |
| Actions secret | `SUPABASE_*` | Project ref, access token, DB URL, JWT, service role |
| Actions secret | `OAUTH_GITHUB_*` | GitHub OAuth app for Supabase Auth |
| Actions secret | `CLOUDFLARE_*` | Edge/DNS automation |
| Actions secret | `RAILWAY_TOKEN` | Legacy — do not use for open-box production |
| Public config | `deploy/*`, `.env.example` | Non-secret contracts only |

## Docker Hub

| Resource | Value |
|----------|-------|
| Image | `openclose8/open-box` |
| Production pin | Digest on Zeabur (immutable) |

## Cloudflare

| Resource | Purpose |
|----------|---------|
| Zone `open-box.space` | DNS + TLS |
| DNS CNAME apex | → `open-box-space.zeabur.app` (proxied) |
| Worker `open-box-gateway` | Front door + `/auth/*` |
| Worker binding `ORIGIN_URL` | Zeabur origin |
| Worker binding `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Auth gateway |
| Worker binding `AUTH_REQUIRED` | `false` until forced auth desired |
| R2 `open-box-files` / `open-box-backups` | Object storage |

## Supabase project `open-box` (`ymhiwerqyegvondndkjn`)

| Resource | Purpose |
|----------|---------|
| Postgres | OpenList `x_*` + `openbox_*` |
| Session pooler `:5432` | Zeabur runtime DB |
| Auth + GitHub provider | Worker OAuth |
| Storage buckets | `open-box-files`, `open-box-backups` |
| Edge Function | `open-box-status` (JWT required) |
| Vault secrets | `openbox_admin_password_meta`, `openbox_db_connection_meta`, plus shared keys |

## Zeabur project `open-box`

| Resource | Purpose |
|----------|---------|
| Service `Open-Box` | Prebuilt image runtime |
| Domain | `open-box-space.zeabur.app` |
| Volume `open-box-data` | `/opt/openlist/data` |
| Health | HTTP `/` on port `web` |
| Env public | `PORT`, `SITE_URL`, `PUBLIC_DOMAIN`, `TZ`, `UMASK`, `DB_TYPE`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME`, `DB_SSL_MODE`, `DB_TABLE_PREFIX` |
| Env secret | `DB_PASS`, `ADMIN_PASSWORD`, `OPENLIST_ADMIN_PASSWORD` |

## Auth surfaces

| Surface | Store |
|---------|-------|
| OpenList admin login | Hashed in `x_users`; bootstrap via Zeabur `ADMIN_PASSWORD` |
| Supabase Auth (GitHub) | Supabase Auth providers + GitHub OAuth app |
| Worker session cookies | Cloudflare Worker after `/auth/callback` |

## Rotation checklist

1. Rotate value in provider secret manager (Zeabur / GitHub / Supabase / Cloudflare).
2. Update dependent runtime (restart Zeabur or redeploy Worker).
3. Verify login and `https://open-box.space` health.
4. Revoke old credential.
