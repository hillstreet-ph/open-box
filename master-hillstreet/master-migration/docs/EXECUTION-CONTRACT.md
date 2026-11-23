# Open-Box and Master-Migration — Singapore execution contract

**State: PREPARED, no production migration started.** Runtime remains Railway and PostgreSQL remains in its existing Supabase projects. Tencent COS is a destination candidate, not a verified registered target. This document is intentionally a deployment gate, not a command to transfer user data.

## Project ownership and naming

Logical resources follow `<project>-sg-<env>-<component>`. Existing provider IDs, project names, database schema names and bucket names remain stable to prevent orphaned dependencies.

- `open-box-sg-prod-app`: Open-Box application (existing Railway)
- `open-box-sg-prod-storage`: application-managed filesystem and file metadata (existing)
- `open-box-sg-prod-cos`: proposed Tencent COS backing/archive destination (not connected)
- `master-migration-sg-prod-control`: central cloud orchestration logical role (not deployed)
- `master-migration-sg-prod-supabase`: both Supabase Postgres projects (not merged)
- `master-migration-sg-prod-databricks`: optional analytics export/import role (warehouse not verified)
- `master-migration-sg-prod-macos`, `master-migration-sg-prod-android`: explicit export ingestion only (not background device agents)

## Destination storage design — one approved existing COS bucket, logical prefixes

```text
master-migration/sg/prod/open-box/files/<snapshot-id>/
master-migration/sg/prod/open-box/runtime-backup/<snapshot-id>/
master-migration/sg/prod/supabase/open-platform/<snapshot-id>/
master-migration/sg/prod/supabase/open-operations/<snapshot-id>/
master-migration/sg/prod/databricks/<catalog>/<schema>/<snapshot-id>/
master-migration/sg/prod/macos/<export-id>/
master-migration/sg/prod/android/<export-id>/
master-migration/sg/prod/_manifests/<run-id>.json
master-migration/sg/prod/_checksums/<run-id>.json
master-migration/sg/prod/_reconcile/<run-id>.json
```

These are proposed key prefixes and **do not** indicate that objects, buckets, cloud users, subscriptions or transfers have been created.

## Migration phases for an eventual cloud controller

| Phase | Work | Completion gate |
|---|---|---|
| 00 discover | Read-only source and destination inventory | Correct account, region, bucket, quota, pricing and permissions independently verified |
| 01 baseline | Schema metadata, actual source bytes, object manifests, last-modified watermarks | Signed snapshot with safe excludes, no secrets or raw production rows in Git |
| 02 backup | Database-consistent snapshots and application-volume data | Encrypted backup and successful independent restore test |
| 03 copy | Bounded resumable source-to-target staged copy | Non-zero-transfer budgets verified, idempotent object names, encrypted transport, checksum parity |
| 04 reconcile | Compare expected/actual object counts, bytes, schema health | No unresolved errors, duplicates or silent data omission |
| 05 canary | Test restored app/DB and query-read paths in an isolated environment | Authentication, uploads, downloads and rollback validated |
| 06 cutover | Change only approved destination pointers in controlled order | Health, TLS, data parity and immediate return-to-Railway procedure |
| 07 maintain | Bounded repeat reconciliation and lifecycle cleanup | Cost ceiling and retention policy, separate immutable source backups |

No phase except 00 metadata inventory is currently enabled. Passing source validators never implies a completed cloud migration.

## Existing observations

- Railway `open-box` production service is successful with image `hillstreet/open-box:main-034feaa`; the mounted volume is **50,000 MB allocated**, actual used bytes unknown.
- Supabase `open-platform` and `open-operations` are both healthy in Singapore, but serve different scopes and must not be merged by name. `open_box` currently has 15 physical tables.
- On 2026-11-23 the read-only Supabase Storage inventory counted 17 private buckets and 71 object metadata entries across both projects. Counts alone do **not** establish backup coverage. See `../inventory/supabase-storage-2026-11-23.json`.
- Databricks integration reports active but warehouse/catalog calls returned invalid/unparseable responses; do not start compute as a test.
- The Tencent web console shows an account-scoped COS bucket label in the URL, but no authenticated Tencent API tool verified ownership, free quota, privileges, storage class or object access. No transfer can be enabled on that evidence alone.

## Autonomous scheduling and isolation

- Reuse the existing recurring **Singapore Migration Readiness** task for report-only checks; **do not create a duplicate schedule or another paid CI server**.
- A future cloud controller may run job-by-job only with dedicated secrets in a recognized cloud secret manager, signed manifests, scoped identities, monotonic resume markers and a hard budget threshold.
- Fail closed on missing OAuth/API capabilities, storage quota, billing confirmation, restore proofs, region restrictions, or dependency health.
- Keep each source in a separate queue with its own checkpoint path and byte limit. Never run untrusted application code inside the backup executor.
- Do not persist any secrets from the conversation or attached credential documents into code, Git, object names or activity logs. Previously disclosed database credentials and service keys should be rotated through their originating consoles.

## Security and data-integrity constraints

- COS is an object store, not a replacement for transactional PostgreSQL, Supabase Auth, or Databricks SQL.
- Never restore a PostgreSQL dump into a live database without staged restore verification, extension/RLS review and replay/rollback.
- Do not assume a Supabase Storage bucket's catalog metadata includes the actual contents of an Open-Box Railway volume. Back these up separately.
- Avoid recursively scanning local macOS/Android devices or registering local runners; ingest only explicit user-created exports.
- Production DNS, Cloudflare Worker origin, Railway volumes and Supabase DSNs remain unchanged until canary checks and recovery plans pass.

## Audit commands for the staged configuration

```sh
python3 master-migration/scripts/validate_manifest.py master-migration/config/singapore.json
python3 master-migration/scripts/audit_sources.py master-migration/sources --json
python3 -m unittest discover -s master-migration/tests -v
```

These are local *verification commands for developers*, not instructions to launch local migration workers. The cloud-only production architecture is still a proposal until actual cloud compute and Tencent access are proven.
