# Open-Box Production

Canonical domain: `https://open-box.space`

## Topology

`open-box.space -> Cloudflare Worker (open-box-gateway) -> Railway Open-Box/OpenList -> Supabase Postgres + Master Storage`

The application runtime target is Railway (issue #28 reverses the earlier Zeabur
decision). This is still the decided topology rather than the observed one: the
Railway project `open-box` (`b65f4f52-404d-4dcb-be94-14a76f9d55ff`, environment
`production`) now exists and `vars.RAILWAY_PROJECT_ID` and
`vars.RAILWAY_ENVIRONMENT_NAME` are bound, but no service runs in it and
`secrets.RAILWAY_TOKEN` is unset — a Railway API token is minted by the account
holder and may not pass through a chat transcript or a command line, so the
promotion workflow cannot run until its owner adds it (see
[deploy/railway/README.md](railway/README.md) step 2).
Zeabur stopped serving `open-box-space.zeabur.app` on 2026-11-02 and is now a
retired reference only: nothing may be deployed to it, the retired project
id `ymhiwerqyegvondndkjn` must never be a target, and
`openbox-deploy.yml` now refuses every run. The site stays down until the
Railway runtime is provisioned and the Worker `ORIGIN_URL` binding is repointed.

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
- Railway: Open-Box/OpenList application runtime (volume at `/opt/openlist/data` for local files/cache).
- Supabase: PostgreSQL (OpenList `x_*` tables + Open-Box `openbox_*` tables), Auth, Storage buckets.
- Master Storage: canonical collected file repository, independent from the application container filesystem.
- rclone worker: one-way collection from external storage into Master Storage.

## Required runtime variables (Railway)

OpenList maps database settings with the `DB_` prefix. Production must use
`DB_DSN` from the provider secret store so the shared project is scoped to
`open_box`; component settings alone omit `search_path`.

Scope the DSN at `open_box` is the target, and it is not the state observed on
2026-11-01: `open_box` exists but holds no tables, while all ten `x_*` tables are
in `public`. The running service therefore reaches them through `public`, and a
DSN whose `search_path` is `open_box` alone — without `public` after it — would
fail to resolve `x_users` on a read. Verify `current_setting('search_path')`
before changing it, and treat moving the tables into `open_box` as its own
reviewed migration with a tested restore first (see
`docs/platform/PRODUCTION_STATUS.md`).

- `PORT=5244`
- `SITE_URL=https://open-box.space`
- `PUBLIC_DOMAIN=open-box.space`
- `TZ=Asia/Manila`
- `UMASK=022`
- `DB_TYPE=postgres`
- `DB_DSN` (secret): verified session-pooler connection for `open-platform`
  (`huadtiuuoiriqrjpjxhr`), with `sslmode=require` and `search_path=open_box`
- `DB_TABLE_PREFIX=x_`
- `RAILWAY_RUN_UID=0` — the image drops to uid 1001 (`USER openlist`) while
  Railway mounts its volume root-owned, and `entrypoint.sh` aborts when
  `./data` is not writable. Running as root inside the container is the
  documented Railway tradeoff; the alternative is a one-off `chown` on the
  volume after creation. Recorded here because it is a real reduction in
  container isolation, not a neutral default.

Cloudflare Worker bindings:

- `APP_NAME=Open-Box`
- `ORIGIN_URL=https://<railway-service-domain>` — the Railway service domain
  printed by the `provision and verify` run. Until the Worker is redeployed with
  this binding the front door still points at the dead Zeabur host, and every
  `open-box.space` check fails even when Railway is healthy. The Worker is
  deployed manually with `npx wrangler deploy`; there is no CI path for it.
- `SUPABASE_URL=https://huadtiuuoiriqrjpjxhr.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY` (secret binding): bind the existing publishable-key
  reference for the same `huadtiuuoiriqrjpjxhr` project as `SUPABASE_URL`; do
  not rotate or copy its value during this configuration repair
- `AUTH_REQUIRED=false` until login flow is verified end-to-end

## Persistence

- OpenList metadata: shared Supabase Postgres, schema `open_box` (`x_*`).
- Local runtime files: Railway volume `/opt/openlist/data`.
- Object files: Supabase Storage buckets `open-box-files`, `open-box-backups` and/or external Master Storage.

## DNS

Production apex `open-box.space` still carries a proxied CNAME to the retired
`open-box-space.zeabur.app`. The Worker route `open-box.space/*` is the active
front door, so where traffic goes is decided by the Worker's `ORIGIN_URL`
binding, not by that record. Repoint or remove the apex CNAME once the Railway
service domain is stable, and re-check TLS afterwards.

## Promotion path

`.github/workflows/openbox-deploy-railway.yml` is the only supported way to put
a build on Railway. It promotes the immutable tag
`hillstreet/open-box:main-<7-char-sha>` onto the channel tag
`hillstreet/open-box:railway` with `docker buildx imagetools create`, refuses to
redeploy unless the channel tag resolves to that exact digest, re-pulls through
`serviceInstanceRedeploy`, waits for a terminal `SUCCESS`/`ACTIVE` deployment
that actually serves the named entry bundle, and then runs the live production
gate. Operator steps and the one-time project setup are in
`deploy/railway/README.md`.

Its guards are deliberate: a write run stops unless
`rotate_confirmed = "yes — allow write"`, a project id equal to the retired
Zeabur project is refused, and the missing `secrets.RAILWAY_TOKEN`,
`vars.RAILWAY_PROJECT_ID`, `secrets.SUPABASE_DB_URL`,
`secrets.DOCKERHUB_USERNAME` and `secrets.DOCKERHUB_TOKEN` are each named without
any value being printed.

## Deployment gate

The retired `ymhiwerqyegvondndkjn` project must not be used for new production
configuration; the workflow also refuses it outright. Do not infer the
replacement pooler hostname or region from the retired project; confirm it in the
canonical provider configuration. Changing the project URL also requires binding
the matching existing publishable key; this does not authorize credential
rotation.

Before starting the new runtime (startup can migrate tables):

1. Verify the runtime role, `open_box` schema ownership/privileges, and the secret
   `DB_DSN` target using read-only checks. Confirm `current_schema()` is
   `open_box` and `current_setting('search_path')` scopes the connection there.
   This check does not pass on the current production database: `open_box` is
   empty and the live tables are in `public`, so a green run here means the
   migration in step 2 has actually been done, not that it is configured.
2. Review any required schema/data migration separately. Validate a backup and
   restore into an isolated target, and retain the old image/configuration as a
   rollback target. Do not automatically migrate or write tables into `public`.
   The ten `x_*` tables are already in `public`, so this rule is a stop on future
   writes there, not a description of an untouched schema. Verified backup
   archives now exist, which is what makes a restore test possible at all.
3. Pair the Worker URL with its existing same-project publishable-key secret
   reference without rotating or exposing the credential.
   Verify `/auth/me`, sign-in callback, and session refresh against that project
   before cutover; preserve `AUTH_REQUIRED=false` until the existing auth gate
   is explicitly approved.
4. Verify the immutable image digest, existing service/volume mapping, health,
   Postgres connectivity, OpenList login, storage read/write, domain/TLS, restart
   recovery, and Sentry release evidence.

A source configuration change is not evidence that these production checks passed.
