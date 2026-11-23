# Open-Box Migration — canonical file index

Default new target: Hong Kong, Tencent `ap-hongkong`. Existing observed Singapore assets stay recorded as Singapore sources.

| Responsibility | Canonical path |
|---|---|
| Parent project ownership | [../../README.md](../../README.md) |
| Hong Kong target and fail-closed flags | [config/hongkong.json](config/hongkong.json) |
| Physical resource map and source/target aliases | [config/resource-registry.json](config/resource-registry.json) |
| Source adapters (Railway/Supabase/Databricks/COS/macOS/Android) | [sources/](sources/) |
| Supabase source storage inventory | [inventory/supabase-storage-2026-11-23.json](inventory/supabase-storage-2026-11-23.json) |
| Tencent Singapore COS/DTS historic evidence | [inventory/tencent-cos-dts-2026-11-23.json](inventory/tencent-cos-dts-2026-11-23.json) |
| Naming and proposed storage layout | [docs/NAMING-AND-STORAGE.md](docs/NAMING-AND-STORAGE.md) |
| Backups, checksums and restore-first policy | [docs/EXECUTION-CONTRACT.md](docs/EXECUTION-CONTRACT.md) |
| Tencent COS/DTS skills/evidence | [docs/TENCENT-COS-DTS-SKILLS.md](docs/TENCENT-COS-DTS-SKILLS.md) |
| Source facts | [docs/SOURCE-CONTRACT.md](docs/SOURCE-CONTRACT.md) |
| Metadata validation | [scripts/validate_manifest.py](scripts/validate_manifest.py), [scripts/audit_sources.py](scripts/audit_sources.py) |
| Regression tests | [tests/](tests/) |

Do not confuse **new target policy** with **existing runtime residence**. COS is object storage, not a transactional PostgreSQL server or Databricks compute instance. No data transfer or paid service begins from these manifests.
