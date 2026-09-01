# Open-Box Production

Canonical domain: `https://open-box.space`

## Topology

`open-box.space -> Cloudflare Worker (open-box-gateway) -> Zeabur Open-Box/OpenList -> Supabase Postgres + Master Storage`

Source collection remains independent:

`Google Drive / Dropbox / OneDrive -> read+copy collector -> Master Storage`

Source files are never automatically moved or deleted. Source deletion must not propagate to the master repository.

## Responsibilities

- GitHub: source, CI/CD and reviewed production changes.
- Cloudflare: DNS/TLS/front-door Worker gateway for `open-box.space`.
- Zeabur: Open-Box/OpenList application runtime (volume at `/opt/openlist/data` for local files/cache).
- Supabase: PostgreSQL (OpenList `x_*` tables + Open-Box `openbox_*` tables), Auth, Storage buckets.
- Master Storage: canonical collected file repository, independent from the application container filesystem.
- rclone worker: one-way collection from external storage into Master Storage.

## Required runtime variables (Zeabur)

OpenList maps env with prefix `DB_` using tags `TYPE/HOST/PORT/USER/PASS/NAME/SSL_MODE` (not `DB_PASS`).

- `PORT=5244`
- `SITE_URL=https://open-box.space`
- `PUBLIC_DOMAIN=open-box.space`
- `TZ=Asia/Manila`
- `UMASK=022`
- `DB_TYPE=postgres`
- `DB_HOST=aws-0-ap-northeast-1.pooler.supabase.com`
- `DB_PORT=5432`
- `DB_USER=postgres.ymhiwerqyegvondndkjn`
- `DB_PASS` (secret)
- `DB_NAME=postgres`
- `DB_SSL_MODE=require`
- `DB_TABLE_PREFIX=x_`

Cloudflare Worker bindings:

- `APP_NAME=Open-Box`
- `ORIGIN_URL=https://open-box-space.zeabur.app`
- `SUPABASE_URL=https://ymhiwerqyegvondndkjn.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` (secret)
- `AUTH_REQUIRED=false` until login flow is verified end-to-end

## Persistence

- OpenList metadata: Supabase Postgres (`x_*`).
- Local runtime files: Zeabur volume `/opt/openlist/data`.
- Object files: Supabase Storage buckets `open-box-files`, `open-box-backups` and/or external Master Storage.

## DNS

Production apex `open-box.space` is a proxied CNAME to `open-box-space.zeabur.app`, with Worker route `open-box.space/*` as the active front door.

## Deployment gate

Verify: application health, Postgres connectivity, persistent volume, OpenList login, storages, domain/TLS, restart recovery.
