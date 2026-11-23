# Naming, ownership and object storage standard

## 1. Singapore-first naming

**Canonical alias:** `<project>-sg-<environment>-<component>`

- Projects: `open-box` or `master-migration`.
- Country: `sg` (Singapore).
- Environment: `prod`, `stage`, or `dev`. Existing staged manifest supports `prod` and `stage` only.
- Components: lowercase kebab-case with one purpose, e.g. `app`, `volume`, `cos-backups`, `postgres`, `databricks`, `dts`.
- **Provider-native IDs never change** as part of naming cleanup. Tencent COS bucket suffixes and external database schema names are preserved.
- Each registry entry has one logical name, one provider and resource type, one recorded physical name or identifier, a clear purpose, and an evidence status.

**Examples**
```text
open-box-sg-prod-app
open-box-sg-prod-volume
open-box-sg-prod-postgres
open-box-sg-prod-cos-backups
open-box-sg-prod-ai-bucket
master-migration-sg-prod-control
master-migration-sg-prod-cos-datalake
master-migration-sg-prod-supabase-platform
master-migration-sg-prod-databricks
master-migration-sg-prod-macos
master-migration-sg-prod-android
```

## 2. Provider resource inventory (not renames)

| Owner | Service | Physical identity | Logical role |
|---|---|---|---|
| open-box | Railway | `open-box` | Current application |
| open-box | Railway | `open-box-volume` | Current persistent files |
| open-box | Supabase | `open-platform.open_box` | Transactional database schema |
| open-box | Supabase Storage | `open-box-backups` | Existing private backup bucket |
| open-box | Tencent COS | `open-box-backups-1531773422` | Private offsite backup candidate |
| open-box | Tencent CI | `open-box-1531773422` | AI bucket created; COS relationship unverified |
| master-migration | Tencent COS | `open-box-tokenhub-datalake-1531773422` | Data lake candidate; current physical name is retained |
| master-migration | Tencent DTS | `dts-g24p3lhq` | Draft/created PostgreSQL migration task, pay-as-you-go |
| master-migration | Supabase | `open-platform`, `open-operations` | Independent database source projects |

For detailed status, see `../config/resource-registry.json`. The Tencent AI bucket and the COS backup bucket are **not interchangeable**, and COS is **not** a transactional Postgres or Databricks warehouse.

## 3. Tencent COS key layout (proposal, not yet created)

Use a small number of *approved existing private Singapore buckets* rather than a new bucket for every source. Inside the shared lake candidate, partition by **project → environment → data domain → snapshot**:

```text
open-box/
  prod/
    backups/railway-volume/<snapshot-utc>/
    backups/supabase-db/<snapshot-utc>/
    assets/raw/<dataset>/<snapshot-utc>/
    assets/verified/<dataset>/<snapshot-utc>/

master-migration/
  prod/
    source/supabase/open-platform/<snapshot-utc>/
    source/supabase/open-operations/<snapshot-utc>/
    source/databricks/<catalog>/<schema>/<snapshot-utc>/
    source/macos/<export-id>/
    source/android/<export-id>/
    meta/manifests/<run-id>.json
    meta/checksums/<run-id>.json
    meta/reconciliation/<run-id>.json
    meta/logs/<run-id>.json
```

Object keys must not contain database passwords, bearer tokens, personal information or email addresses. Keep backup buckets **private** and static website hosting **off**. Keep manifest data separate from user data.

## 4. Retention and cost controls

- Do not enable COS lifecycle expiration, public read, cross-region replication or archival transitions until recovery objectives and charges are validated.
- Never delete Railway or Supabase source based only on an upload success response.
- Verify all bytes and snapshot integrity, actual object versions, encryption at rest, and destination cost quota.
- Tencent DTS task `dts-g24p3lhq` is explicitly **pay-as-you-go** and only `Creation completed`; it must not be started as a free default.
- Keep desktop/Android exports *explicit*; do not deploy a local crawling agent.

## 5. Source of truth and updates

`config/resource-registry.json` is the canonical **metadata mapping**. Add or change aliases via reviewed GitHub changes, and attach independent cloud evidence for status transitions. Do not make the registry authoritative for secrets, instance runtime state, or data durability.
