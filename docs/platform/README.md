# Open-Box Platform

Open-Box is HillStreet's branded distribution of the OpenList engine, deployed
on Railway with Supabase as its PostgreSQL source of truth and an
optional Cloudflare OAuth gateway.

## Branches

- `main` — production-ready
- `staging` — release candidates
- `develop` — active development
- `upstream-sync/*` — automated upstream integration (PR to staging only)

## Production

- Railway project `open-box` (`b65f4f52-404d-4dcb-be94-14a76f9d55ff`), environment
  `production`, service `open-box` — created 2026-11-04. The service inside it does
  **not** exist yet, and `secrets.RAILWAY_TOKEN` is unset, so nothing on Railway is
  verified as serving anything. Runbook: [deploy/railway/README.md](../../deploy/railway/README.md).
- Database: Supabase Postgres (session pooler)
- Auth: OpenList JWT (`x_users`); Supabase Auth reserved for future gateway

## Hosting roles

- Railway runs the stateful Go service and mounts `/opt/openlist/data`.
- Zeabur was the previous runtime; it stopped serving on 2026-11-02 and its
  deployment workflow now refuses every run.
- Supabase Postgres stores the Open-Box application tables.
- Cloudflare provides DNS, TLS, WAF, reverse proxying, and optional GitHub OAuth.
- Supabase Auth and Open-Box JWT are deliberately separate trust layers.

## Railway requirement

Dockerfile must **not** contain `VOLUME` — Railway mounts `/opt/openlist/data` externally.
