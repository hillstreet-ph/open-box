# Open-Box — master-hillstreet

**Owner:** `master-hillstreet/open-box` (Singapore default).

## Logical structure

```text
open-box/
├── app/        # Existing Railway production service; not stored in this folder
├── database/   # Existing Supabase open-platform.open_box tables
├── files/      # Existing Railway persistent volume at /opt/openlist/data
├── backups/    # Existing Supabase and private Tencent COS backup candidates
└── ai-bucket/  # Tencent CI AiBucket; not the same as a COS bucket
```

These are **conceptual resource groups**. This README deliberately avoids creating empty, duplicate application, database or object-storage directories. The real Open-Box application code remains at the current repository root.

- Railway project: `b65f4f52-404d-4dcb-be94-14a76f9d55ff`; production remains active.
- Supabase Open-Box schema: `open-platform.open_box`.
- Existing Tencent private COS backup bucket: `open-box-backups-1531773422` (browser-observed, not API-tested).
- Existing Tencent AI bucket: `open-box-1531773422` (creation response, not object-store integration proof).
- Running application is not migrated merely because this organization folder exists.

Cross-provider physical IDs, source evidence and migration safety controls: [../master-migration/config/resource-registry.json](../master-migration/config/resource-registry.json).
