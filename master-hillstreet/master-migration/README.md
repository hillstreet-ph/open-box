# Master Migration — Singapore-first inventory and safety gates

**Status: draft only. This directory is not an autonomous migration server.** No Tencent bucket, COS object, Databricks warehouse, Railway workload, desktop daemon, database migration, scheduled job or production cutover is created or activated by this configuration.

## Verified source systems (23 Nov 2026)

- Railway Open-Box application: existing service in project `b65f4f52-404d-4dcb-be94-14a76f9d55ff`; Docker image `hillstreet/open-box:main-034feaa`; health endpoint `/ping`; published application port `5244`.
- Railway Open-Box data volume: mounted at `/opt/openlist/data`, 50 GB **allocated**; actual used capacity not yet measured.
- Supabase `open-platform`: project `huadtiuuoiriqrjpjxhr`, healthy in Singapore `ap-southeast-1`; `open_box` schema contains 15 physical tables in a read-only inventory. The `open-operations` database is outside this first-phase Open-Box migration.
- Databricks connector has an active account connection, but the SQL warehouse inventory response was invalid. Warehouse, catalog, region, compute limits and COS compatibility remain unverified.
- Tencent COS and Lighthouse instance/bucket inventories are not verified through an authorized API call. A Tencent OAuth plugin configuration is **not** evidence of a completed account connection.
- Open-Box Tencent runtime migration is separately proposed in draft PR #104. This control manifest must not duplicate or overwrite that runtime.

## Naming contract

All **new logical resource names** use `<project>-sg-<environment>-<purpose>`, with project `open-box` or `master-migration`, `sg` for Singapore and environment `prod` or `stage`. Existing names and database schemas are not renamed. Tencent COS bucket names may require a Tencent account-specific suffix; never create buckets from these logical placeholders.

## Data classes and required migration methods

1. **Files/object storage:** Open-Box and other specifically approved files → verified Singapore Tencent COS bucket, with source inventory, encryption/ACL review, quota/cost ceiling, integrity checks, resumable checkpoints and no source deletion.
2. **PostgreSQL:** Supabase database, auth, storage metadata, RLS, triggers, extensions and migrations must be exported/restored as a **separate**, tested database workflow. COS is not a SQL database. Do not move all schemas automatically or change active DSNs.
3. **Analytics:** Databricks warehouse requires separately verified workspace/catalog/compute and supported COS integration. Never start a billable cluster as a connectivity test.
4. **Desktop imports:** only explicit, pre-exported snapshots; no local agent or automatic filesystem scanning.

## Execution sequence (fail closed)

- **Discover:** Verify ownership, active COS buckets/Lighthouse instances, Databricks warehouse, storage quota, transfer charges, data region, source database schema and Railway volume actual usage.
- **Protect:** Record image digest, health checks, permissions, immutable backups, destination free capacity, source object listing and restore proof.
- **Shadow:** Copy only authorized objects to an existing target with strict cost ceiling and checkpoints; independently compare sampled bytes/checksums and metadata. Do not copy relational databases as generic objects and assume they are migrated.
- **Canary:** Verify app `/ping`, reads, uploads/downloads on test data, authentication, database connectivity, monitoring and restart recovery.
- **Cutover:** Only after a verified destination and rollback. Preserve Railway and the original volume through the rollback window.
- **Continuous:** A future cloud scheduler may perform budgeted reconciliation and report changes after integration tests and evidence of existing free capacity. Nothing is scheduled by this manifest.

## Guardrails and validation

```sh
python3 master-migration/scripts/validate_manifest.py master-migration/config/singapore.json
python3 -m unittest discover -s master-migration/tests -v
```

The validator rejects duplicate/invalid names, wrong regions, credential-like properties, enabled targets, local execution, billable resources, deletions, data copying and cutovers. Eight tests were executed successfully in isolation before creating the branch. **A passing validator does not establish that Tencent access, backup, production migration, Databricks or automation are working.**

Next blockers: authenticate Tencent read-only inventory; confirm an existing Singapore COS bucket and the account's actual free credits; inspect data size and backups; resolve Databricks inventory; then perform non-production cloud canary. All production services remain unchanged.
