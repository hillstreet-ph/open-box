# Open-Box Production

Canonical domain: `https://open-box.space`

## Topology

`open-box.space -> Cloudflare Worker (open-box-gateway) -> Zeabur Open-Box/OpenList -> Supabase Postgres + Master Storage`

Source collection remains independent:

`Google Drive / Dropbox / OneDrive -> read+copy collector -> Master Storage`

Integration settings are available at `/settings/integrations`, with the legacy
`/connect-storage` path serving the same view. It is safe to deploy
before provider authorization because it contains no credentials and creates no
placeholder mounts. Provider accounts are connected later through the
authenticated storage manager; Box uses the rclone collector.

Source files are never automatically moved or deleted. Source deletion must not propagate to the master repository.

## Responsibilities

- GitHub: source, CI/CD and reviewed production changes.
- Cloudflare: DNS/TLS/front-door Worker gateway for `open-box.space`.
- Zeabur: Open-Box/OpenList application runtime (volume at `/opt/openlist/data` for local files/cache).
- Supabase: PostgreSQL (OpenList `x_*` tables + Open-Box `openbox_*` tables), Auth, Storage buckets.
- Master Storage: canonical collected file repository, independent from the application container filesystem.
- rclone worker: one-way collection from external storage into Master Storage.

## Required runtime variables (Zeabur)

OpenList maps database settings with the `DB_` prefix. Production must use
`DB_DSN` from the provider secret store so the shared project is scoped to
`open_box`; component settings alone omit `search_path`.

- `PORT=5244`
- `SITE_URL=https://open-box.space`
- `PUBLIC_DOMAIN=open-box.space`
- `TZ=Asia/Manila`
- `UMASK=022`
- `DB_TYPE=postgres`
- `DB_DSN` (secret): verified session-pooler connection for `open-platform`
  (`huadtiuuoiriqrjpjxhr`), with `sslmode=require` and `search_path=open_box`
- `DB_TABLE_PREFIX=x_`

Cloudflare Worker bindings:

- `APP_NAME=Open-Box`
- `ORIGIN_URL=https://open-box-space.zeabur.app`
- `SUPABASE_URL=https://huadtiuuoiriqrjpjxhr.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` (secret binding): bind the existing publishable-key
  reference for the same `huadtiuuoiriqrjpjxhr` project as `SUPABASE_URL`; do
  not rotate or copy its value during this configuration repair
- `AUTH_REQUIRED=false` until login flow is verified end-to-end

## Persistence

- OpenList metadata: shared Supabase Postgres, schema `open_box` (`x_*`).
- Local runtime files: Zeabur volume `/opt/openlist/data`.
- Object files: Supabase Storage buckets `open-box-files`, `open-box-backups` and/or external Master Storage.

## DNS

Production apex `open-box.space` is a proxied CNAME to `open-box-space.zeabur.app`, with Worker route `open-box.space/*` as the active front door.

## Deployment gate

The retired `ymhiwerqyegvondndkjn` project must not be used for new production
configuration. Do not infer the replacement pooler hostname or region from the
retired project; confirm it in the canonical provider configuration. Changing
the project URL also requires binding the matching existing publishable key;
this does not authorize credential rotation.

Before starting the new runtime (startup can migrate tables):

1. Verify the runtime role, `open_box` schema ownership/privileges, and the secret
   `DB_DSN` target using read-only checks. Confirm `current_schema()` is
   `open_box` and `current_setting('search_path')` scopes the connection there.
2. Review any required schema/data migration separately. Validate a backup and
   restore into an isolated target, and retain the old image/configuration as a
   rollback target. Do not automatically migrate or write tables into `public`.
3. Pair the Worker URL with its existing same-project publishable-key secret
   reference without rotating or exposing the credential.
   Verify `/auth/me`, sign-in callback, and session refresh against that project
   before cutover; preserve `AUTH_REQUIRED=false` until the existing auth gate
   is explicitly approved.
4. Verify the immutable image digest, existing service/volume mapping, health,
   Postgres connectivity, OpenList login, storage read/write, domain/TLS, restart
   recovery, and Sentry release evidence.

A source configuration change is not evidence that these production checks passed.
