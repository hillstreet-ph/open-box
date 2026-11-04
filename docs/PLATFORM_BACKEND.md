# Platform backend assignment

This repository is assigned to the shared **open-platform** Supabase project.

## Non-secret configuration

| Setting | Value |
|---|---|
| Supabase project | `open-platform` |
| Supabase project reference | `huadtiuuoiriqrjpjxhr` |
| Supabase URL | `https://huadtiuuoiriqrjpjxhr.supabase.co` |
| PostgreSQL schema | `open_box` (target) — verified 2026-11-01: `open_box` exists and is empty, the live `x_*` tables are in `public` |
| Sentry organization | `hillstreet` |
| Sentry project | `open-box` |
| GitHub repository | `hillstreet-ph/open-box` |
| Container image | `${DOCKERHUB_USERNAME}/open-box` |

## Required deployment secrets

Configure these only in GitHub Actions secrets and the Railway service variable collection:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` when server-side migrations or direct PostgreSQL access are required
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `RAILWAY_TOKEN` — the API token the promotion workflow authenticates with. Set it from a terminal with `read -s`, never through a chat transcript or a command line
- `SENTRY_AUTH_TOKEN` only for release/source-map upload
- Application-specific secrets

Public client builds may use the Supabase URL and publishable key. Never expose the service-role key, database password, Docker Hub token, Railway token, or Sentry auth token in source code, build logs, Google Drive, or client bundles.

## Deployment boundary

1. GitHub is the source of truth.
2. CI validates the project and builds a versioned container.
3. Docker Hub stores the approved image as an immutable `main-<sha>` tag.
4. The promotion run copies that manifest onto the `railway` channel tag, refuses to continue unless the channel digest equals the promoted digest, and re-pulls the Railway service.
5. Railway runs the approved image; the run then probes the live origin, not the build.
6. Cloudflare provides DNS, TLS, WAF, and public routing through the `open-box-gateway` Worker, whose `ORIGIN_URL` must point at the Railway service domain.
7. Sentry records releases and runtime errors.
8. Supabase migrations must target schema `open_box` and must be reviewed before production execution.

## Current credential status

The previously shared Supabase, Docker Hub, and Zeabur management tokens were exposed in chat. The owner attested that they were rotated, and that attestation is what `rotate_confirmed = "yes — allow write"` encodes — it is a precondition the workflow accepts, not evidence this repository could verify. The Railway API token is a new credential minted after that exposure, so it must never pass through a chat transcript; see [deploy/railway/README.md](../deploy/railway/README.md) step 2.
