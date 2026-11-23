# master-hillstreet

**Single organizational parent** for independent HillStreet projects. **New default target: Hong Kong** (`HK`; Tencent `ap-hongkong`). Existing Singapore infrastructure remains in its *actual* regions until an independently verified migration.

```text
master-hillstreet/
├── README.md
├── config/
│   └── projects.json
├── open-box/                    # Cloud-drive router front end
│   ├── app/                     # Railway live application reference
│   ├── database/                # Supabase transactional metadata
│   ├── files/                   # Railway persistent volume
│   ├── backups/                 # Private snapshots and archival
│   ├── ai-bucket/               # Tencent CI AiBucket reference
│   ├── integrations/
│   │   └── cloud-drives/        # Google Drive, OneDrive, Dropbox, WebDAV, local export adapters
│   └── migration/               # Hong Kong target; original Singapore sources
│       ├── config/
│       │   ├── hongkong.json
│       │   └── resource-registry.json
│       ├── sources/
│       ├── inventory/
│       ├── docs/
│       ├── scripts/
│       └── tests/
├── open-system/                 # Separate software project
├── open-claw/                   # Separate agent runtime project
└── open-connect/                # Separate integration gateway project
```

## Physical repository ownership

The folders in this document are a **directory and configuration index** in `hillstreet-ph/open-box`, not a forced merger of existing application code. Independent project repositories:

- [open-box](https://github.com/hillstreet-ph/open-box)
- [open-system](https://github.com/hillstreet-ph/open-system)
- [open-claw](https://github.com/hillstreet-ph/open-claw)
- [open-connect](https://github.com/hillstreet-ph/open-connect)

[Project registry](config/projects.json) is the parent-level project index. Each project retains its own source code, CI and production resources. Further confirmed projects may be indexed without copying their repositories.

## Naming and region policy

- Proposed *new* aliases: `<project>-hk-<environment>-<component>`
- Tencent Hong Kong destination: `ap-hongkong`
- Supabase existing projects: Singapore `ap-southeast-1`; availability of a separate Hong Kong deployment must be verified before any database relocation
- Existing Railway Open-Box service and Tencent Singapore buckets: retain physical IDs and original regions
- Data in Singapore is **not** in Hong Kong just because its registry alias changes
- Credentials, tokens, local device data and secrets do not belong in this repository

## Operational limitations

This is an organization-only change on [draft PR #105](https://github.com/hillstreet-ph/open-box/pull/105). Do not auto-merge or treat it as a ready production cutover. No new Hong Kong COS buckets, database replicas, Databricks compute, Railway services or automated source synchronizers are created by these files. Paid DTS execution, DNS changes, database restores and deletion stay disabled until verified separately.
