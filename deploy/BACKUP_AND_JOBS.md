# Open-Box backup, jobs, and anti-data-loss

Canonical domain: `https://open-box.space`

## Goals

- Survive image upgrades and Zeabur redeploys without wiping data
- Avoid admin lockout after restarts
- Scheduled backups and health checks for humans and AI agents

## What persists across redeploy / new image

| Data | Store | Survives image update? |
|------|--------|-------------------------|
| OpenList users (admin password hash) | Supabase Postgres `x_users` | Yes |
| Settings / storages / tasks | Supabase `x_*` | Yes |
| Open-Box app tables | Supabase `openbox_*` | Yes |
| Local cache / config.json extras | Zeabur volume `open-box-data` → `/opt/openlist/data` | Yes (volume kept) |
| Object files | Supabase Storage + R2 `open-box-files` | Yes |
| DB dumps | Storage `open-box-backups` + GitHub Actions artifacts | Yes |

**Do not** delete the Zeabur volume or wipe `x_users` on deploy.  
**Do not** remove `ADMIN_PASSWORD` from Zeabur env (bootstrap safety if users table is empty).

## Anti-lockout rules (agents must follow)

1. Prefer Postgres `x_users` as source of truth for admin login.
2. Keep Zeabur `ADMIN_PASSWORD` + `OPENLIST_ADMIN_PASSWORD` set (private).
3. To reset admin: set env password → delete only the `admin` row → restart service (creates admin). Never drop all tables.
4. Never set `AUTH_REQUIRED=true` on the Worker without a verified OAuth login path.
5. Never point production DNS back to Railway.

## Scheduled jobs already active

### GitHub Actions

| Workflow | Schedule (UTC) | Purpose |
|----------|----------------|---------|
| `openbox-backup.yml` | `0 2 * * *` daily | `pg_dump` → gzip → Actions artifact (14d) + Supabase Storage `open-box-backups` |
| `openbox-maintenance.yml` | `30 3 * * *` daily | Production smoke + optional backup upload |
| `openbox-docker.yml` | on push to `main` / tags | Build/push image (does not wipe volume/DB) |

Manual: Actions → workflow → **Run workflow**.

### Supabase `pg_cron`

| Job | Schedule | Purpose |
|-----|----------|---------|
| heartbeat | every 15 min | Write `openbox_job_runs` alive row |
| queue_stats | hourly | PGMQ queue metrics into `openbox_job_runs` |
| cleanup | `0 4 * * *` | Delete `openbox_job_runs` older than 14 days |

Extensions: `pg_cron`, `pg_net`, `pgmq` present.

## Redeploy procedure (safe)

1. Build/push new image (Docker Hub) or let `openbox-docker.yml` run.
2. Update Zeabur service image/digest **without** removing volume `open-box-data`.
3. Keep all `DB_*` and `ADMIN_*` env vars.
4. Restart service; confirm RUNNING + `https://open-box.space` 200.
5. Confirm admin login still works.
6. If login fails: recreate admin via env (see anti-lockout), do not reset database.

## Backup restore (high level)

1. Download latest dump from Storage `open-box-backups` or Actions artifact.
2. Restore into a staging DB first when possible.
3. Point Zeabur `DB_*` only after verification.
4. Volume restore is separate (Zeabur volume snapshot / file copy under `/opt/openlist/data`).

## Agent maintenance checklist

- [ ] Domain 200 and `x-zeabur-*` headers (not Railway)
- [ ] Zeabur RUNNING + volume present
- [ ] `DB_PASS` (not `DB_PASSWORD`) and pooler host
- [ ] Admin login or known reset path
- [ ] R2 + Storage buckets exist
- [ ] Backup workflow green in last 48h
- [ ] `pg_cron` heartbeat recent in `openbox_job_runs`

## Related docs

- `deploy/CONFIG_MAP.md` — provider secret map
- `deploy/PRODUCTION.md` — topology
- `deploy/zeabur/template.yaml` — service template
