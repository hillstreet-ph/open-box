# master-hillstreet

Single logical parent for the HillStreet Singapore-first infrastructure.

```text
master-hillstreet/
├── open-box/         # Open-Box application, metadata and storage mapping
└── master-migration/ # Cross-provider inventory, source adapters and migration controls
```

The project folders describe ownership and canonical migration configuration. **They do not rename or move existing cloud resources.** Railway serves the Open-Box production application; Supabase owns PostgreSQL, and Tencent COS is an object-storage candidate. This hierarchy is versioned in the existing Open-Box repository as an organization layer, not a new paid cloud account, storage bucket or runtime.

Location defaults: Singapore (Tencent `ap-singapore`; Supabase `ap-southeast-1`). All new logical names follow `<project>-sg-<environment>-<component>`, preserving historical resource IDs.

**Canonical migration registry:** [master-migration/config/resource-registry.json](master-migration/config/resource-registry.json)

**Current operating mode:** migration inventory and validation only. No live transfers, DNS changes, paid Tencent DTS execution or source deletion.
