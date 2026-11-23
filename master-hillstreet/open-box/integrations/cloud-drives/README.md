# Open-Box — Cloud-drive router integration contract

**Parent:** `master-hillstreet/open-box` · **Default for new Tencent resources:** Hong Kong (`ap-hongkong`). This file describes **routing and authorization responsibilities**, not a verified live mount inventory.

## Open-Box as a router, not a warehouse

Open-Box exposes storage providers through a single authenticated frontend. A provider mount is a *connection to its existing source*; connecting it must **not** silently copy the provider's content into Tencent COS. COS backups, database snapshots and Databricks analytics datasets are separate opt-in data pipelines.

| Provider/source | Connection model | Authorized connection status | Safety rule |
|---|---|---|---|
| Google Drive | OAuth provider account and per-drive scopes | Not audited in this PR | Do not store OAuth tokens in Git |
| OneDrive | Microsoft OAuth/Graph per-account scope | Not audited in this PR | Preserve delegated access and drive IDs |
| Dropbox | OAuth scoped to connected account | Not audited in this PR | Preserve original file versioning and permissions |
| WebDAV | HTTPS URL + secret from approved secret manager | No endpoint verified in this PR | Require TLS and least-privilege access |
| macOS | User-selected, explicitly exported local snapshot | No export onboarded | No continuous local filesystem crawler |
| Android | User-selected, explicitly exported device snapshot | No export onboarded | No background device-agent or permission escalation |
| Railway volume | Existing Open-Box persistent service data | Verified mounted at `/opt/openlist/data` | Backup and test restore before changing mount |
| Supabase Storage | Private buckets in the existing Singapore projects | Metadata inspected; not copied | Do not convert object-store metadata into DB tables |
| Tencent COS | Proposed backup/datalake object target | Singapore console observations only; Hong Kong not provisioned | Do not auto-create buckets or copy before quota and API tests |

## Mount metadata schema (design, not active configuration)

Store one **non-secret** record per mount: `mount_id`, `provider`, `account_reference`, `source_root_id`, `owner_project`, `display_label`, `access_mode`, `region_observed`, `connection_status`, `health_checked_at`, `read_only`.

Do **not** store access tokens, refresh tokens, cookies, auth headers, WebDAV passwords, signed URLs, or third-party account data in GitHub or COS manifest metadata.

## Standard logical mount naming

```text
open-box-hk-prod-mount-gdrive-<opaque-id>
open-box-hk-prod-mount-onedrive-<opaque-id>
open-box-hk-prod-mount-dropbox-<opaque-id>
open-box-hk-prod-mount-webdav-<opaque-id>
open-box-hk-prod-import-macos-<export-id>
open-box-hk-prod-import-android-<export-id>
```

Existing mount names stay unchanged until source IDs, sharing permissions, and fallback behavior are inventoried. Hong Kong naming indicates *new target policy*, not actual remote file residency.

## Separation of concerns

- **Frontend:** route and display provider files; authenticate against existing Open-Box identity policy.
- **Mount adapters:** per-provider OAuth/WebDAV; metadata cache and rate-limit-safe directory browsing.
- **Supabase:** application catalog and authorization metadata; remain transactional.
- **Railway:** existing Open-Box runtime and mount data; do not deploy a second copy.
- **Tencent COS:** eventual private backups / lake object staging with checksums and lifecycle policy.
- **Migration:** [Hong Kong target plan](../../migration/config/hongkong.json), [source inventory](../../migration/sources/), [registry](../../migration/config/resource-registry.json).

## Migration safety

Do not start a bulk drive backup, register local device access, expose provider objects publicly, rewrite OAuth scopes, overwrite WebDAV server content, or switch the live router based on this document. First require authorized API inventory, storage cost ceiling, snapshots, integrity tests and rollback.
