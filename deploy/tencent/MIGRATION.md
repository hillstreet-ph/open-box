# Open-Box first: Railway → Tencent Cloud migration gate

**Status: prepared only, not deployed.** No Tencent instance or free-trial entitlement is verified, and production DNS/Cloudflare Worker origins remain unchanged. No additional services or purchases are authorized by this document.

## Why the application entrypoint was restored

The `Dockerfile` runs `/entrypoint.sh version` during image assembly and starts `/entrypoint.sh server` for the OpenList runtime. Commit `74ec5065` replaced this with a self-hosted GitHub runner registration script requiring `RUNNER_TOKEN`, which caused a real Railway build failure. The application script is restored from the last known OpenList-specific version (`6014d09be063`). A repository runner belongs in its **own container and entrypoint**, never the Open-Box application image.

## Verified Railway source of truth (2026-11-23)

- Railway project: `open-box` `b65f4f52-404d-4dcb-be94-14a76f9d55ff`; environment: production `d6643a74-1232-4d7c-8f6c-a6549de452e8`.
- Service: `open-box` `3c9c8d2b-6677-4261-88be-11e0c4c9be2a`, currently successful, image `hillstreet/open-box:main-034feaa`, one replica, Singapore.
- Runtime data: attached Railway volume `open-box-volume` at `/opt/openlist/data`, **50 GB provisioned**; actual utilization not yet measured. This may include uploads and cache. Do not recreate a blank volume as a replacement.
- Variables present (values never copied to this repo): `ADMIN_PASSWORD`, `DB_DSN`, `DB_TABLE_PREFIX`, `DB_TYPE`, `LOG_ENABLE`, `OPENLIST_ADMIN_PASSWORD`, `PORT`, `PUBLIC_DOMAIN`, `RAILWAY_RUN_UID`, `SITE_URL`, `TZ`, `UMASK`.
- App listens on TCP `5244` and responds at `/ping`. Public domain `open-box.space` is fronted by a Cloudflare Worker, and is also mapped as a Railway custom domain.
- External PostgreSQL is already in use. **Do not migrate database schemas** as part of a host-only move. Verify actual current DSN search path and connectivity separately.

## Target architecture: existing Tencent host only

- A verified *already-owned* Tencent Lighthouse or CVM host, with available Linux resources and a documented billing/free-trial end date, is a precondition. Do **not** purchase a new instance, upgrade a plan, or enable automatic renewals.
- `compose.yml` defines **only the Open-Box app**. It binds port 5244 on localhost, mounts the restored files at `/srv/open-box/data`, uses an immutable verified image digest supplied at runtime, and loads secrets from excluded `runtime.env`. The file does not provision a paid server.
- TLS ingress must be configured separately at an existing Tencent reverse proxy or Cloudflare Tunnel under the current allowed quota; do not expose plaintext TCP 5244 to the Internet. Verify your chosen TLS ingress and SNI before updating `open-box-gateway`'s `ORIGIN_URL` binding.
- Give Open-Box a **repository-scoped GitHub self-hosted runner** in a distinct non-root process/service on that Tencent host only if there is enough measured capacity. This is not a paid VM per runner. Its job workspace, labels and credentials must not be shared with other projects.
- Self-hosted GitHub Actions still requires GitHub Actions scheduling. If avoiding the scheduler is mandatory, use a vetted event/queue process on an existing server instead, not the GitHub runner binary. The two modes are mutually distinct.
- Docker-capable CI runs only trusted branches/maintainer-approved jobs; never give untrusted pull-request scripts unrestricted host Docker access.

## Migration acceptance sequence (all required before traffic cutover)

1. **Destination evidence:** read the Tencent instance ID, status, region, CPU/RAM/disk/free space, public IP and billing state from authenticated Tencent API/console. Verify that running Open-Box plus its own runner creates **no new billable instance** and fits existing compute/storage/transfer allowances.
2. **Source baseline:** record health check, immutable running image digest (architecture must match Tencent), `docker image inspect` entrypoint, DB connectivity, mount source, actual used bytes, file count, uid/gid, and current Cloudflare Worker origin (without printing credentials).
3. **Backup:** create a recoverable, integrity-checked copy of `/opt/openlist/data` into already-approved storage with sufficient capacity. Verify listing/checksum; export current app settings securely. Keep Railway and its volume intact. Do not delete or modify the source.
4. **Target stage:** restore data to `/srv/open-box/data` with correct permissions; load protected Tencent host environment, verify `DB_DSN` still reaches the existing PostgreSQL over TLS, and start the **application-only** Compose service.
5. **Functional gate:** test `/ping`, authentication, settings API, listing files, downloading a safe sample, uploads against isolated test data, persistence across restart, Sentry logs, and the Cloudflare proxy route. Ensure database has not been reset or migrated.
6. **Project runner gate:** register a separate Open-Box-only cloud runner using a short-lived registration token acquired from a correctly scoped GitHub credential. No token is stored in repo, container image, process arguments or logs. Prove a harmless read-only job runs, then a bounded test job. Do not reuse a previously pasted short-lived token.
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:11ddc2b1d1939978840f1c2b555c47b47055884da9ee5e3f335237bb6fa231ef -->

7. **Final volume gate and cutover:** save the current Worker `ORIGIN_URL`. Stop and drain all Railway writers to `/opt/openlist/data` (including background jobs and direct-origin requests) and pause Tencent writers. With both volumes stable, synchronize any additions, changes and deletions since step 3 from Railway to Tencent. Verify the restored tree against the frozen source by path, checksum, ownership and permissions. If any difference is unexplained or writes resume, hold the switch and repeat this gate. Only after this and the preceding gates pass, switch the Worker to the verified Tencent HTTPS origin and enable writes on Tencent alone. Keep Railway and its volume intact. Verify the custom domain, TLS and browser paths without changing DNS.
8. **Rollback:** if a health or consistency check fails after cutover, the designated migration lead owns the rollback decision. Before reverting `ORIGIN_URL`, pause and drain writers on both hosts and preserve a recoverable copy of each volume. Account for uploads, changes and deletions on Tencent since cutover as well as writes to shared PostgreSQL, including settings and metadata changes independent of uploads. Record which changes occurred (or evidence of none), how to reconcile them, and who will carry out the plan. Apply and verify the plan: ensure Railway can serve the retained files with the current database state; do not rewind the shared database. Volume parity alone does not establish this. If reconciliation is uncertain, stay in maintenance. Only after the lead signs off, restore the saved Railway origin, verify service and resume writes on Railway alone.

<!-- /coderabbit-ai-generated:v1 -->
9. **Cost audit:** after cutover confirm Tencent, Cloudflare, Supabase, Docker Hub and Railway billing; cancel Railway only after explicit review of data retention and destination readiness.

## Blocking facts as of preparation

- The open Tencent Cloud browser tabs show a COS migration console and a Lighthouse **purchase page**. Neither proves an active Tencent compute instance or a cost-free entitlement.
- No Tencent-specific connected API management tool was found, and the connected macOS management environment has no configured Tencent CLI credentials. An authenticated Tencent console/API inspection is still needed before any remote execution.
- Existing Open-Box `docker-compose.yml` at repository root points to a different immutable image than the live Railway deployment. Do not treat it as proven production state.
- A 50 GB allocated Railway volume does not establish transferable used bytes, backup space or target capacity.
- The source domain and Cloudflare gateway are still production systems. No host, DNS, Worker setting, image or credential changes were performed for this draft.
