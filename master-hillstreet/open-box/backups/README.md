# Private object storage

**Logical owner:** `master-hillstreet/open-box/backups`

Existing Supabase `open-box-backups` private bucket and Tencent COS `open-box-backups-1531773422` (console-observed). Objects have not been transferred. Keep ACL private and static website OFF; validate restoration and storage costs before enabling transfers.

**New target default:** Hong Kong (`ap-hongkong` on Tencent); existing physical sources remain in Singapore. **State:** documentation and inventory mapping only. No production resource was created, renamed or modified by this directory.

Canonical physical resource references: [../migration/config/resource-registry.json](../migration/config/resource-registry.json).
