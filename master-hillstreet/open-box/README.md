# Open-Box — cloud-drive router

**Owner:** `master-hillstreet/open-box` · **Default target region:** Hong Kong · **Current production:** existing Railway deployment.

Open-Box is a web frontend and router to independent storage providers, *not* the sole place where all connected files are copied. Provider authorizations and existing account locations remain independent.

```text
open-box/
├── app/                     # Railway production Open-Box runtime
├── database/                # Supabase open_platform / open_box metadata
├── files/                   # Existing Railway persistent volume
├── backups/                 # Private backup objects
├── ai-bucket/               # Tencent AI resource, separately identified
├── integrations/
│   └── cloud-drives/        # Connector inventory and safety contracts
└── migration/
    ├── config/hongkong.json
    ├── config/resource-registry.json
    ├── sources/
    ├── inventory/
    ├── docs/
    ├── scripts/
    └── tests/
```

Current source observations: Railway `open-box` running in Singapore, Supabase `open-platform` with `open_box` schema in Singapore, and Tencent COS backup/datalake buckets observed in Singapore. Those resources are **not** relocated by this draft. The separately created Tencent `AiBucket` is not interchangeable with COS.

The [connector map](integrations/cloud-drives/README.md) distinguishes Google Drive, OneDrive, Dropbox, WebDAV and explicit macOS/Android exports. No new OAuth permissions are granted by the map.

[Hong Kong migration configuration](migration/config/hongkong.json) · [Resource registry](migration/config/resource-registry.json)

Do not deploy a duplicate router, overwrite existing mounts or make the backup bucket public.
