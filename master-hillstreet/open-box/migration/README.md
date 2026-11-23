# Open-Box Migration — Hong Kong target

**Parent:** `master-hillstreet/open-box/migration`. New Tencent destination region: **Hong Kong** (`ap-hongkong`). This is **staged configuration**, not a deployed data-copying agent.

## Current source reality

- Railway Open-Box service is currently running in Singapore; persistent volume data remains there.
- Supabase `open-platform` and `open-operations` are existing Singapore projects, not Hong Kong deployments.
- Previously observed Tencent COS buckets and Tencent CI AI bucket are in Singapore; these are **sources**, not new Hong Kong targets.
- Databricks connection exists but catalogs, compute, region and destination quotas remain unverified.
- macOS/Android are optional explicitly exported files, never background device scanners.

## Organization

```text
migration/
├── README.md
├── INDEX.md
├── config/
│   ├── hongkong.json
│   └── resource-registry.json
├── sources/
│   ├── railway/source.json
│   ├── supabase/source.json
│   ├── databricks/source.json
│   ├── tencent-cos/source.json
│   ├── macos/source.json
│   └── android/source.json
├── inventory/            # Historic source evidence, immutable facts
├── docs/                 # Operational history and runbooks
├── scripts/              # Read-only validation
└── tests/                # Region, alias, safety checks
```

- **New names:** `open-box-hk-prod-<purpose>`. Source names retain `-sg-` to identify where they really live.
- **Default target only:** new Hong Kong resources, once authorized and verified.
- **Safety:** no automatic DTS activation, new spend, cloud cutover, local agent, secret upload or source deletion.
- **Source control:** legacy migration configuration on the previous draft path is superseded by this directory.
- **Integration mapping:** [Cloud drives](../integrations/cloud-drives/README.md).

## Validation

```sh
python3 master-hillstreet/open-box/migration/scripts/validate_manifest.py master-hillstreet/open-box/migration/config/hongkong.json
python3 master-hillstreet/open-box/migration/scripts/audit_sources.py master-hillstreet/open-box/migration/sources --json
python3 -m unittest discover -s master-hillstreet/open-box/migration/tests -v
```

A passing test only validates planned metadata. Backup, COS auth, Databricks query, Hong Kong destination, restore canary, network and billing are not established by directory organization.
