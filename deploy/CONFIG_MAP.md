# Open-Box configuration map

Canonical domain: `https://open-box.space`

Never commit secret values. Store secrets only in provider secret managers.

## Topology

`open-box.space` → Cloudflare Worker `open-box-gateway` → Railway service `open-box` → Supabase Postgres / Storage / Auth / Edge Functions; files also on Cloudflare R2.

This is the decided topology, not yet the observed one. The Worker's `ORIGIN_URL`
still points at the retired Zeabur origin (`https://open-box-space.zeabur.app`),
so the public site is down until step 5 of
[the Railway runbook](railway/README.md) repoints it. See
[the production status](../docs/platform/PRODUCTION_STATUS.md) for what is
verified and what is not.

## GitHub (`hillstreet-ph/open-box`)

| Kind | Name | Purpose |
|------|------|---------|
| Actions secret | `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | Publish `hillstreet/open-box`; reused by the Railway promotion (same image repository) |
| Actions secret | `RAILWAY_TOKEN` | Railway API token for `openbox-deploy-railway.yml`. **Not set.** Minted in the Railway dashboard by the account holder and stored from a terminal with `read -s` — never through a chat transcript or a command line. Until it exists, no Railway write can run. |
| Actions secret | `SUPABASE_DB_URL` | Scoped Postgres DSN consumed by the Railway provisioning step |
| Actions secret | `ZEABUR_API_TOKEN` | Retired platform; read-only diagnostics only |
| Actions variable | `RAILWAY_PROJECT_ID` | Set: `b65f4f52-404d-4dcb-be94-14a76f9d55ff` |
| Actions variable | `RAILWAY_ENVIRONMENT_NAME` | Set: `production` (lowercase — the name the CLI created; the workflow's own default is `Production`, so the variable is what makes the lookup agree) |
| Actions secret | `SUPABASE_*` | Project ref, access token, DB URL, JWT, service role |
| Actions secret | `OAUTH_GITHUB_*` | GitHub OAuth app for Supabase Auth |
| Actions secret | `CLOUDFLARE_*` | Edge/DNS automation |
| Public config | `deploy/*`, `.env.example` | Non-secret contracts only |

## Docker Hub

| Resource | Value |
|----------|-------|
| Image | `hillstreet/open-box` |
| Per-commit tag | `main-<7-char-sha>` — immutable, published by `openbox-docker.yml` on every merge to `main` |
| Railway channel tag | `railway` — the only tag the Railway service watches. Promotion copies a per-commit manifest onto it with `docker buildx imagetools create` and then hard-fails unless the channel digest equals the promoted digest, so "the tag moved" is never taken as proof. |
| Production pin | `sha256:3dec2e8a5c081fc19a7e28d1fba8416e126cd6ef4f027710d5178d23c0f6d06a` (immutable; Zeabur-era pin, kept for forensics) |
| Rollback pin | `sha256:d43cd28fe3decbf948a784abb9ffd6ad1699ea81e4fd3d9a57fe0f13b737ac1c` |

## Cloudflare

| Resource | Purpose |
|----------|---------|
| Zone `open-box.space` | DNS + TLS |
| DNS CNAME apex | → `open-box-space.zeabur.app` (proxied) — stale since the retirement; a cleanup item, not the cutover switch, because the Worker is the front door |
| Worker `open-box-gateway` | Front door + `/auth/*`; deployed by hand with `npx wrangler deploy`, there is no CI path for it |
| Worker binding `ORIGIN_URL` | **Must become the Railway service domain** printed by runbook step 3. It still holds the retired `https://open-box-space.zeabur.app`, which is why `open-box.space` is down. |
| Worker binding `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Auth gateway; both must belong to `huadtiuuoiriqrjpjxhr`; bind the existing matching key reference without rotating it |
| Worker binding `AUTH_REQUIRED` | `false` until forced auth desired |
| R2 `open-box-files` / `open-box-backups` | Object storage |

## Supabase project `open-platform` (`huadtiuuoiriqrjpjxhr`)

| Resource | Purpose |
|----------|---------|
| Postgres | Open-Box tables are `x_*` only, and they are in `public` today. The `open_box` schema exists and holds no tables; no `openbox_*` table exists anywhere in the project. |
| Session pooler | Provider-verified host/role; secret `DB_DSN` with `sslmode=require`. `search_path=open_box` is the target, not the current state — with `open_box` empty, the runtime resolves its tables through `public`. |
| Auth + GitHub provider | Worker OAuth |
| Storage buckets | `open-box-files` (no objects), `open-box-backups` (holds the database archives; both created 2026-09-22) |
| Edge Function | `open-box-status` (JWT required) |
| Vault secrets | `openbox_admin_password_meta`, `openbox_db_connection_meta`, plus shared keys |

### Database ground truth, verified 2026-11-01

Read-only checks against `huadtiuuoiriqrjpjxhr`, cross-checked by what
`Open-Box Maintenance`'s `backup-db` job listed from `information_schema`:

- `public` holds exactly ten base tables belonging to Open-Box —
  `x_access_tokens`, `x_meta`, `x_revoked_sessions`, `x_search_nodes`,
  `x_setting_items`, `x_sharing_dbs`, `x_ssh_public_keys`, `x_storages`,
  `x_task_items`, `x_users` — alongside roughly ninety others from the shared
  project (103 `CREATE TABLE` statements in a `--schema=public` dump).
- `open_box` exists and contains no tables.
- No `openbox_*` table exists in any schema, and no Go code names one
  (`grep -rn openbox_ --include='*.go'` returns nothing). The name survives only
  in `supabase/migrations/20260831232500_*` and `20260901125810_*`, which grant
  privileges on a table the application never reads. Do not treat those files as
  a live surface.
- None of the repository's ten `supabase/migrations/*` versions appear in
  `supabase_migrations.schema_migrations`, even though that table holds 104 other
  rows. The platform schema in this repository has not been applied to
  production, and applying it is a separate reviewed change — it is DDL against a
  shared database, so it is not something a CI job should do as a side effect.
- Settings are rows of `x_setting_items`, not an `x_settings` table. A check that
  greps a dump for `x_settings` fails on a correct backup.

Consequence for the backup job: its scope is discovered from the catalog and
verified per qualified table name, because a schema dump cannot be limited to the
ten Open-Box tables and a count comparison rejects a correct archive.

## Railway project `open-box` (the runtime target)

| Resource | Value |
|----------|-------|
| Project | `open-box` — `b65f4f52-404d-4dcb-be94-14a76f9d55ff`, workspace "Kobeplay Workspace", billing active and under its limit |
| Environment | `production` — `d6643a74-1232-4d7c-8f6c-a6549de452e8` |
| Service `open-box` | **Does not exist yet.** `openbox-deploy-railway.yml` creates it in the "provision and verify" pass; do not create it by hand, or the volume, healthcheck and domain will not match the run's assertions |
| Image contract | `railway.json`: `DOCKERFILE` builder at repo `Dockerfile`, healthcheck `/ping`, `restartPolicyType: ON_FAILURE`, max 10 retries |
| Volume | mounted at `/opt/openlist/data` (created by the provisioning step) |
| Env public | `SITE_URL`, `PUBLIC_DOMAIN`, `TZ=Asia/Manila`, `UMASK=022`, `DB_TYPE=postgres`, `DB_TABLE_PREFIX=x_` |
| Env secret | `DB_DSN` (from `secrets.SUPABASE_DB_URL`, read from a `0600` temp file by jq), `RAILWAY_RUN_UID=0` |
| Domain | the Railway-issued `*.up.railway.app` service domain, printed by step 3 and pasted into the Worker's `ORIGIN_URL` |

`RAILWAY_RUN_UID=0` is not a preference. The image runs as uid 1001, but Railway
mounts the volume root-owned, so an unprivileged process cannot write
`/opt/openlist/data`. Running as uid 0 restores function at the cost of container
isolation — a real reduction, documented here rather than buried. The narrower fix
would be an upstream image that chowns its data directory at startup; until then
this is the tradeoff.

Note that the Railway env sets no `ADMIN_PASSWORD` / `OPENLIST_ADMIN_PASSWORD`.
That is deliberate: `x_users` already holds the administrator row in the shared
Supabase database, so the first-boot bootstrap path never runs, and a password
value has no reason to exist in a variable collection. Use Settings › My Account
(or the reset switch during a maintenance boot) to change the login password.

## Zeabur project `open-box` — retired 2026-11-02

The rows below describe the platform that stopped serving, kept for forensics and
for the one workflow that still reads the old platform's effect on the shared
`version` row (`openbox-zeabur-diagnose.yml`). Nothing here is a runtime target.

| Resource | Purpose |
|----------|---------|
| Service `6a967b310e919aed614685ce` | The runtime that answered the site until 2026-11-02. Template `PREBUILT_V2`, port `5244` as `web`. |
| Service `6adf9e880ca070d4379475d0` | Second service in the same project (`open-box-next.zeabur.internal`, port `8080`). Its deployments are Git-driven off `refs/heads/main` of this repository, so it rebuilt on every merge; it owned no public domain. **Open owner decision:** confirm this service is stopped, because a Git-driven rebuild against the shared production database is a write path that bypasses the Railway gate. |
| Domain | `open-box-space.zeabur.app` and `open-box.space`, both bound to `6a967b310e919aed614685ce` (the apex `redirectTo`s the origin host) |
| Volume `open-box-data` | `/opt/openlist/data` |
| Health | HTTP `/` on port `web` |
| Env public | `PORT`, `SITE_URL`, `PUBLIC_DOMAIN`, `TZ`, `UMASK`, `DB_TYPE`, `DB_TABLE_PREFIX` |
| Env secret | `DB_DSN`, `ADMIN_PASSWORD`, `OPENLIST_ADMIN_PASSWORD` |

"Prebuilt" describes the template, not the deploy trigger. Read twice on 2026-11-01,
the runtime service was serving images that no promotion dispatched — each
stamped seconds after a `Open-Box Docker Hub` run re-pointed `latest` — so
`latest` is both non-monotonic and auto-consumed here. The pin did not hold:
after PR #81 and #82 merged, the service served those builds with no promotion
run in the window, which is what a mutable tag re-resolving looks like. CI no
longer moves `latest` on a push to `main` — `openbox-docker.yml` publishes
`latest` only on a `v*` tag push — so merges cannot roll this service any more.
Pointing the service at an immutable tag, or disabling auto-deploy, is still
the complete fix. See
[the production status](../docs/platform/PRODUCTION_STATUS.md#promotion-executed-2026-11-01-sixth-pass--production-runs-the-main-tip).

Only `OPENLIST_ADMIN_PASSWORD` reaches the application, and only while the
administrator row is being created on a fresh database — `ADMIN_PASSWORD` is not
read by any code path, and a rotated value for an existing administrator is
reported at boot and ignored unless `OPENLIST_ADMIN_PASSWORD_RESET=1` is also
set. Change the login password through the account page (or with the reset
switch during a maintenance boot), not by editing the environment alone.

The retired project `ymhiwerqyegvondndkjn` is not a runtime target. See
[the production deployment gate](PRODUCTION.md#deployment-gate) for schema,
matching-key, backup/restore, and rollback requirements before any cutover.

## Auth surfaces

| Surface | Store |
|---------|-------|
| OpenList admin login | Hashed in `x_users`; bootstrap via the runtime's `OPENLIST_ADMIN_PASSWORD` on first boot only (on Railway this path never runs — see the Railway section above) |
| LDAP sign-in | `x_settings` `ldap_*` rows, not environment values. `ldap_login_enabled` is a PUBLIC setting and the sign-in page routes the Login button to LDAP while it reads as available, so an enabled-but-addressless directory used to replace the password prompt for everyone; since `main-ef241d2` it is published only when usable — the stored row is untouched, the public answer is not. Production currently holds `ldap_login_enabled='true'` with an empty `ldap_server`, and publishes `false` because of it. To set a directory, use Settings › LDAP. To force the row off from outside the UI: `UPDATE public.x_settings SET value='false' WHERE key='ldap_login_enabled';` then restart, because a bare SQL write does not reload the setting cache |
| Supabase Auth (GitHub) | Supabase Auth providers + GitHub OAuth app |
| Worker session cookies | Cloudflare Worker after `/auth/callback` |

## Rotation checklist

1. Rotate value in provider secret manager (Railway / GitHub / Supabase / Cloudflare).
2. Update dependent runtime (redeploy the Railway service or redeploy the Worker).
3. Verify login and `https://open-box.space` health.
4. Revoke old credential.
