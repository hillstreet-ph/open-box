# open-system

**Parent:** `master-hillstreet` · **Project:** `open-system` · **New target default:** Hong Kong (`ap-hongkong` on Tencent).

**Actual source code:** [hillstreet-ph/open-system](https://github.com/hillstreet-ph/open-system).

**Purpose:** Independent service / application system. This folder is a **central metadata pointer**, not a duplicate checkout, monorepo import, server, database or deployment.

Suggested project-level organization when adopted in its own repository:

```text
open-system/
  app/             # Source and runtime code in the actual project repository
  integrations/    # External systems, OAuth and provider adapters
  infrastructure/  # Deployment, regions, permissions, monitoring
  data/            # Schemas and non-sensitive migration metadata
  backups/         # Backup policies, not copies of secret data
  migration/       # Staged Hong Kong migration plan if applicable
  docs/            # Operational runbooks
  tests/           # Validated changes
```

No existing deployment, data, app repo, secrets or hosting location was modified by this directory. Physical source regions must be verified per provider before any migration.
