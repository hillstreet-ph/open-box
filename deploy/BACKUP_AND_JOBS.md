# Open-Box backup, jobs, and anti-data-loss

Canonical domain: `https://open-box.space`

## Goals

- Survive image upgrades and Railway redeploys without wiping data
- Avoid admin lockout after restarts
- Scheduled backups and health checks for humans and AI agents

## What persists across redeploy / new image

| Data | Store | Survives image update? |
|------|--------|-------------------------|
| OpenList users (admin password hash) | Supabase Postgres `x_users` | Yes |
| Settings / storages / tasks | Supabase `x_*` in `public` | Yes |
| Local cache / config.json extras | Railway volume mounted at `/opt/openlist/data` | Yes (volume kept) |
| Object files | Supabase Storage + R2 `open-box-files` | Yes |
| DB dumps | Storage `open-box-backups` + GitHub Actions artifacts | Yes |

There are no `openbox_*` tables. The Open-Box application's tables are the `x_*`
rows in `public`; the `open_box` schema exists and is empty. A backup check that
greps for `openbox_*` rejects a correct archive — see
[the configuration map](CONFIG_MAP.md).

**Do not** delete the service volume or wipe `x_users` on deploy.  
**Do not** rely on `ADMIN_PASSWORD` / `OPENLIST_ADMIN_PASSWORD` to fix a login on an
installed database — they are first-boot values only.

## Anti-lockout rules (agents must follow)

1. Prefer Postgres `x_users` as source of truth for admin login.
2. The Railway variable collection deliberately holds no `ADMIN_PASSWORD` / `OPENLIST_ADMIN_PASSWORD`: `x_users` already has the administrator row, so the first-boot bootstrap path never runs. Set passwords through Settings › My Account, or with `OPENLIST_ADMIN_PASSWORD_RESET=1` during a maintenance boot.
3. To reset admin: set env password → delete only the `admin` row → restart service (creates admin). Never drop all tables.
4. Never set `AUTH_REQUIRED=true` on the Worker without a verified OAuth login path.
5. Production runs on Railway. Zeabur was the previous runtime and was retired on 2026-11-02; do not point the Worker's `ORIGIN_URL` or DNS at the retired Zeabur origin.

## Scheduled jobs already active

### GitHub Actions

| Workflow | Schedule (UTC) | Purpose |
|----------|----------------|---------|
| `openbox-backup.yml` | `0 2 * * *` daily | `pg_dump` → gzip → Actions artifact (14d) + Supabase Storage `open-box-backups` |
| `openbox-maintenance.yml` | `30 3 * * *` daily | Production smoke + optional backup upload |
| `openbox-docker.yml` | on push to `main` / tags | Publish the immutable `main-<sha>` tag (and `latest` on a `v*` tag); does not touch the volume or the database |
| `openbox-deploy-railway.yml` | manual dispatch only | Provision the Railway service, promote a build onto the `railway` channel tag, and run the production gate. Runbook: [railway/README.md](railway/README.md) |

Manual: Actions → workflow → **Run workflow**.

> Neither Railway workflow can run yet: `secrets.RAILWAY_TOKEN` is unset, and the
> token must be added by the account holder from a terminal, not through a chat
> transcript. `openbox-deploy.yml` (the old Zeabur path) now refuses every run.

### Supabase `pg_cron`

| Job | Schedule | Purpose |
|-----|----------|---------|
| heartbeat | every 15 min | Write `openbox_job_runs` alive row |
| queue_stats | hourly | PGMQ queue metrics into `openbox_job_runs` |
| cleanup | `0 4 * * *` | Delete `openbox_job_runs` older than 14 days |

Extensions: `pg_cron`, `pg_net`, `pgmq` present.

## Redeploy procedure (safe)

1. Merge to `main`; `openbox-docker.yml` publishes the immutable `main-<sha>` tag.
2. Dispatch `openbox-deploy-railway.yml` in `promote and verify` mode with that `image_tag`, the `expected_frontend_asset` and `rotate_confirmed=yes — allow write`. It copies the manifest onto the `railway` channel tag, refuses to continue if the channel digest does not match, re-pulls the service **without** touching the volume, and then runs the production gate.
3. All `DB_*` variables stay in the Railway variable collection; never clear it as part of a promotion.
4. Confirm the gate's own output: the named entry asset is actually served, `/ping` answers, and `site_name` reads `Open-Box` from Postgres.
5. Confirm admin login still works.
6. If login fails: recreate admin via env (see anti-lockout), do not reset database.

## Backup restore (high level)

1. Download latest dump from Storage `open-box-backups` or Actions artifact.
2. Restore into a staging DB first when possible.
3. Point the Railway `DB_DSN` variable only after verification.
4. Volume restore is separate (Railway volume snapshot / file copy under `/opt/openlist/data`).

## Agent maintenance checklist

- [ ] Domain 200, and the response comes from the Railway origin, not the retired Zeabur host
- [ ] Railway service `SUCCESS` + volume present
- [ ] `DB_PASS` (not `DB_PASSWORD`) and pooler host
- [ ] Admin login or known reset path
- [ ] R2 + Storage buckets exist
- [ ] Backup workflow green in last 48h
- [ ] `pg_cron` heartbeat recent in `openbox_job_runs`

## Related docs

- `deploy/CONFIG_MAP.md` — provider secret map
- `deploy/PRODUCTION.md` — topology
- `deploy/railway/README.md` — the Railway runbook (provision, promote, cutover, rollback)
- `deploy/zeabur/template.yaml` — the retired platform's service template, kept for forensics
