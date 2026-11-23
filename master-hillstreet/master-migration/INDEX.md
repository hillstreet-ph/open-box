# HillStreet Singapore — Migration Control Index

**Purpose:** One professional control plane for project resource naming, inventories, migrations and recovery. This folder is a **GitHub draft configuration**, not a deployed server.

## Projects

- **open-box** — application service and its files, transactional database and backups.
- **master-migration** — shared inventory and orchestration definitions for all approved sources. Never combine its control data with production app data.

## Authoritative files

| Concern | Source of truth |
|---|---|
| Logical resource names, provider IDs, roles and status | [config/resource-registry.json](config/resource-registry.json) |
| Singapore region and fail-closed execution flags | [config/singapore.json](config/singapore.json) |
| Source-level adapters and inventory states | [sources/](sources/) |
| COS and DTS observations | [inventory/tencent-cos-dts-2026-11-23.json](inventory/tencent-cos-dts-2026-11-23.json) |
| Supabase bucket counts | [inventory/supabase-storage-2026-11-23.json](inventory/supabase-storage-2026-11-23.json) |
| Naming, folder layout and object key standard | [docs/NAMING-AND-STORAGE.md](docs/NAMING-AND-STORAGE.md) |
| Restore and cutover gates | [docs/EXECUTION-CONTRACT.md](docs/EXECUTION-CONTRACT.md) |
| Tencent CI/DTS and agent skills | [docs/TENCENT-COS-DTS-SKILLS.md](docs/TENCENT-COS-DTS-SKILLS.md) |
| Inventory validation | [scripts/audit_sources.py](scripts/audit_sources.py), [scripts/validate_manifest.py](scripts/validate_manifest.py) |

## Proposed runtime separation

```text
open-box/
  app/             # Railway production app (existing; not moved here)
  database/        # Existing Supabase open_box schema
  files/           # Existing Railway /opt/openlist/data
  backups/         # Existing Supabase bucket + Tencent COS destination candidate

master-migration/
  sources/
    railway/       # Application and volume snapshots
    supabase/      # Open-platform and open-operations logical DB snapshots
    databricks/    # Analytics export, workspace unverified
    tencent-cos/   # Destination inventory, not active transfers
    macos/         # Explicit exports only
    android/       # Explicit exports only
  config/          # Names, resource map and policy
  inventory/       # Timestamped observations
  docs/            # Runbooks
  scripts/         # Read-only validators
  tests/           # Policy tests
```

These are *logical* project layers; existing live resources stay in their actual providers. Do not create duplicate folders, schemas, buckets or servers with these names solely to mirror this document.

## Operational rule

1. **Observe** existing physical resource and account ownership.
2. **Register** logical alias in `resource-registry.json`.
3. **Validate** region, duplicate aliases, permissions, retention, actual bytes, expected cost and backups.
4. **Run** read-only checks; fail closed if any dependency is unverified.
5. **Stage** an encrypted resumable transfer only after a separate verified destination and a successful restore rehearsal.
6. **Reconcile** counts, bytes, checksums and versions.
7. **Cut over** only after explicit reversible health checks; preserve original data.

No secrets, passwords, connection strings, private keys or signing tokens are permitted in the registry. No production transfer, DTS task execution or Terraform provisioning has been enabled.

## CI verification

```sh
python3 master-migration/scripts/validate_manifest.py master-migration/config/singapore.json
python3 master-migration/scripts/audit_sources.py master-migration/sources --json
python3 -m unittest discover -s master-migration/tests
```

A passing local validator is not a live cloud connectivity test. For current blockers consult the latest inventory and readiness report.
