> **Historical source-evidence runbook (Singapore, 2026-11-23).** The new *target default* is Hong Kong (`ap-hongkong`) under `master-hillstreet/open-box/migration/`. Singapore resources described below retain their real source regions. New authoritative configuration: [Hong Kong plan](../config/hongkong.json) and [current registry](../config/resource-registry.json). Do not execute legacy Singapore destination examples as an active transfer.

# Singapore-first cloud migration source catalog

**Status: staged, inventory-only.** This directory contains explicit per-source configurations and a read-only validator. It is **not a deployed migration engine**, a transfer authorization, or a completed provider connection.

## Layout

```text
master-migration/
  config/singapore.json            # Existing six-resource planning manifest
  sources/
    railway/source.json            # Existing Open-Box app and volume
    supabase/source.json           # Existing Singapore Postgres projects
    databricks/source.json         # Analytics integration; inventory unresolved
    tencent-cos/source.json        # Singapore target candidate; bucket unverified
    macos/source.json              # Optional user-selected export import
    android/source.json            # Optional user-selected export import
  scripts/
    validate_manifest.py           # Existing planning policy validator
    audit_sources.py               # New source-wide fail-closed inventory check
  tests/
    test_validate_manifest.py      # Existing policy checks
    test_audit_sources.py          # 12 source-inventory unit tests
  docs/
    SOURCE-CONTRACT.md             # This file
```

## Naming rules

**New logical resource names:** `<project>-sg-<environment>-<purpose>`

- Project: `open-box` or `master-migration`
- Region: `sg` denotes Tencent `ap-singapore` or Supabase `ap-southeast-1`
- Environment: `prod` or `stage`
- Purpose: short lowercase kebab-case, e.g. `supabase`, `databricks`, `tencent-cos`, `macos`, `android`
- **Do not rename existing** Railway projects, Supabase schemas, GitHub repos or Databricks catalogs. Names here are inventory aliases, not proof of provider-side creation.
- Real Tencent COS buckets require an account-ID suffix and uniqueness; do not create a bucket from logical name alone.

**Proposed object keys** within an approved *existing* Singapore COS bucket:

```text
master-migration/sg/prod/open-box/files/<date>/<immutable-object-key>
master-migration/sg/prod/supabase/open-platform/<snapshot-id>/...
master-migration/sg/prod/supabase/open-operations/<snapshot-id>/...
master-migration/sg/prod/databricks/<catalog>/<schema>/<dataset>/<snapshot-id>/...
master-migration/sg/prod/macos/<export-id>/...
master-migration/sg/prod/android/<export-id>/...
master-migration/sg/prod/manifests/<run-id>.json
master-migration/sg/prod/reconciliation/<run-id>.json
```

The paths above are **proposed**. They do not mean uploads or bucket provisioning have occurred.

## Provider-specific rules

| Source | Verified evidence | Separate migration method |
|---|---|---|
| Railway | Open-Box Docker app `hillstreet/open-box:main-034feaa`; allocated 50 GB volume at `/opt/openlist/data` | Determine actual used bytes; checksum-backed file snapshot; keep Railway original |
| Supabase | `open-platform` and `open-operations` both healthy in Singapore; `open_box` holds 15 application tables | PostgreSQL 17-compatible logical backup/restore including roles/RLS/extensions/Auth/Storage metadata; test separately |
| Databricks | Connected toolkit account; SQL warehouse inventory returned malformed success body | Confirm workspace, region, catalogs, permissions, job compute and cost; export structured tables in documented formats only |
| Tencent COS | Bucket label observed in Tencent browser URL, not authenticated API result | Verify account, region, bucket ownership, pricing, security, versioning and available capacity before use |
| macOS | No authorized export | Never crawl or execute local device; accept explicitly supplied archive via cloud upload |
| Android | No authorized export | Never initiate background phone access; accept explicit, authorized export only |

**COS is an object store, not a live relational database nor a running Databricks warehouse.** An uploaded `pg_dump` can be a backup artifact, but does not become a queryable or authenticated PostgreSQL service by itself.

## Unattended operation design

The intended managed cloud job phases are:

1. Read-only discovery and baseline snapshots with signed provenance.
2. Cost/region/quota guard: fail closed on unverified Tencent entitlement or Databricks compute pricing.
3. Consistent, encrypted snapshots with auditable hashes and retention plans.
4. Bounded resumable copy and independent size/hash comparisons to approved storage.
5. Reconciliation reports with exact source/destination identity, counts, bytes and error ledger.
6. Canary restores and read/write tests on isolated data; keep source authoritative until independently validated.
7. Guarded cutover and reversible routing once tested; no automatic deletion or permanent orphaning.
8. Incremental, idempotent replication with rate limits, conflict resolution and drift reports.

**This implementation covers only phase 1 configuration and validation.** A cloud scheduler and storage connector with approved identity, already-owned capacity and live observations are required for later phases. Do not run automatic transfer on a timer merely because a manifest exists.

## Integration map

- **GitHub**: source, review, audit scripts and PR gates; the existing Railway self-hosted GitHub runner can only execute Actions jobs while GitHub Actions scheduling works.
- **Railway**: current Open-Box production host and rollback source; never alter `/opt/openlist/data` before backup and restore verification.
- **Tencent COS**: proposed regional archival, object staging and distribution layer, after verified bucket access.
- **Supabase**: current live PostgreSQL metadata and service authentication; keep database authority unchanged during first phase.
- **Databricks**: separate optional analytics warehouse; never start compute to prove connectivity.
- **Cloudflare**: current public edge routing and TLS; preserve the old `ORIGIN_URL` until an independently verified new origin is approved.
- **Sentry**: target error monitoring; integrations and project IDs not yet inventoried.
- **Linear**: proposed change management and migration tasks; project/issue IDs not yet inventoried.

## Validation

```sh
python3 master-migration/scripts/validate_manifest.py master-migration/config/singapore.json
python3 master-migration/scripts/audit_sources.py master-migration/sources --json
python3 -m unittest discover -s master-migration/tests -v
```

All 12 source-unit tests passed in an isolated Python test environment on November 23, 2026. This does **not** prove a live Tencent connection or any data transfer.

## Required evidence before promoting any source

- Confirmed resource owner and exact IDs (including Singapore region)
- Source data inventory and checksum baseline; actual used bytes rather than allocated size
- Approved secret management and least-privilege access (no credentials in Git or this manifest)
- Destination storage availability and free/paid quota ceilings
- Database-consistent export and independent restore test where applicable
- Conflict policy, resume watermark, transfer error/duplicate handling, encryption
- Canary validation, rollback and customer-facing uptime checks

No automatic billing, server creation, snapshots, object copying, user-device access, database alterations, DNS changes or deletion is authorized by these manifests.
