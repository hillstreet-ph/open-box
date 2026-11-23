# Master HillStreet — Hong Kong naming and cloud storage standards

## Default policy

**Parent:** `master-hillstreet`. **Project owner:** `master-hillstreet/open-box`. **Migration folder:** `master-hillstreet/open-box/migration`.

For **new resources** the canonical naming convention is `<project>-hk-<environment>-<component>`. Tencent destination region is `ap-hongkong`; all physical resources already in Singapore must be recorded as **source** locations, not relabeled Hong Kong.

Supabase existing `open-platform` and `open-operations` projects are in `ap-southeast-1`. A Hong Kong Supabase project is **not** assumed to be offered or provisioned. Provider availability, billing, backup/recovery and application compatibility must be verified before migration.

## Logical project hierarchy

```text
master-hillstreet/
  open-box/
    app/
    database/
    files/
    backups/
    ai-bucket/
    integrations/cloud-drives/
    migration/
      config/hongkong.json
      config/resource-registry.json
      sources/
      inventory/
      docs/
      scripts/
      tests/
  open-system/
  open-claw/
  open-connect/
```

Independent physical code repositories remain under `hillstreet-ph` and are indexed at `master-hillstreet/config/projects.json`. This hierarchy does **not** create any new paid runtime or storage bucket.

## Examples

```text
open-box-hk-prod-app
open-box-hk-prod-cos
open-box-hk-prod-postgres
open-box-hk-prod-migration-control
open-box-hk-prod-migration-warehouse
open-system-hk-prod-app
open-claw-hk-prod-gateway
open-connect-hk-prod-gateway
```

When a physical source lives in Singapore, its observed resource name continues to contain `-sg-` and its `target_name` explicitly uses `-hk-`. Do not rename source resources or recreate them just to enforce logical patterns.

## Object storage prefixes — planned, not provisioned

Under **an approved existing private Hong Kong COS bucket**, consider these paths only after verified access, cost and quota:

```text
master-hillstreet/
  hk/
    prod/
      open-box/
        files/raw/<dataset>/<snapshot>/
        files/verified/<dataset>/<snapshot>/
        backup/railway-volume/<snapshot>/
        backup/supabase/<snapshot>/
      open-system/
        backup/<snapshot>/
      open-claw/
        backup/<snapshot>/
      open-connect/
        backup/<snapshot>/
      migration/
        manifests/<run-id>.json
        checksums/<run-id>.json
        reconciliation/<run-id>.json
```

Do not put secrets, account emails or access tokens in object keys. Keep object ACLs private and disable static website hosting on private backups. Object storage is not PostgreSQL, Supabase Auth or Databricks compute.

## Router integration boundaries

Open-Box provides a frontend and access router to independently authorized cloud mounts: Google Drive, OneDrive, Dropbox, WebDAV and optional exported macOS/Android files. It must not silently relocate or duplicate third-party data. Each provider retains OAuth/account boundaries, rate limits and source access controls. See [cloud-drive contract](../../integrations/cloud-drives/README.md).

## Release and migration gates

1. Read-only inventory with exact provider ID, source region, used bytes and permissions.
2. Hong Kong destination exists and is authorized, within a verified budget.
3. Encrypted consistent snapshot and independently tested restore.
4. Bounded resumable copy, parity checks, retries and drift/reconciliation reports.
5. Canary, rollback and health validation before any production routing changes.
6. Never delete source data based only on upload success, or run Tencent DTS automatically when billing is unverified.

**All migration entries remain disabled in the current draft.**
