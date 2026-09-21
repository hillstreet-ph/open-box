# CLAUDE.md — Open-Box

> AI agent collaboration guide for the Open-Box project.

## Project Identity

- **Name**: Open-Box
- **Role**: Data/Artifact Plane — Binary artifact storage, R2 metadata, file management
- **Language**: Go
- **Organization**: hillstreet-ph
- **Repository**: [github.com/hillstreet-ph/open-box](https://github.com/hillstreet-ph/open-box)

## Architecture Position

Open-Box is the **data/artifact plane** of the HillStreet open-platform stack. It manages binary file storage via Cloudflare R2 with metadata tracked in Supabase.

```
[Open-Connect] → [Open-System] → [Open-Box (this)]
                                       ↕
                              [Cloudflare R2 Storage]
                              [Supabase Metadata]
```

### Sister Projects

| Project | Role | Relationship |
|---------|------|-------------|
| open-connect | Control plane | UI for artifact browsing/management |
| open-system | Execution plane | Produces artifacts that Open-Box stores |
| **open-box** | Data plane | This repo — stores and serves files |

## Infrastructure Stack

| Layer | Service | Details |
|-------|---------|---------|
| Source | GitHub | hillstreet-ph/open-box, branch: main |
| Database | Supabase | Project: huadtiuuoiriqrjpjxhr, Schema: open_box |
| Container | Docker Hub | hillstreet/open-box |
| Runtime | Zeabur | Project: open-box-project (service: Open-Box) |
| Storage | Cloudflare R2 | Binary object storage |
| Edge | Cloudflare Workers | Wrangler config in deploy/cloudflare/wrangler.toml |

## Database Schema

### open_box schema
- `artifacts` — file metadata (name, type, mime, size, R2 keys, checksums, tags)
- `artifact_versions` — version history with per-version R2 keys
- `access_grants` — per-artifact access control (user/role/public × read/write/admin)

### Storage Architecture
- **Metadata**: Supabase PostgreSQL (open_box schema)
- **Binary data**: Cloudflare R2 (referenced by r2_bucket + r2_key in artifacts table)
- **Edge proxy**: Cloudflare Workers serve files with auth checks

## Key Files

- `.env.example` — database and R2 configuration
- `deploy/cloudflare/wrangler.toml` — Cloudflare Worker bindings (Supabase URL)
- `Dockerfile` — multi-stage Go build

## Development Workflow

```
feature/* → development → PR → main → Docker build → Docker Hub → Zeabur deploy
```

## Important Rules for AI Agents

1. **Go project** — follow Go conventions (gofmt, go vet, go test)
2. **R2 keys are immutable** — once an artifact version is published, its R2 key should not change
3. **Versioning** — artifacts support multiple versions; never overwrite, always create new versions
4. **Access grants** — check before serving any file
5. **Checksums** — always compute and store checksums on upload
6. **Schema isolation** — all tables are in the `open_box` schema
7. **Cloudflare Workers** — wrangler.toml references Supabase URL as a binding

## Quick Start for New AI Agents

1. Read this file and the Go source structure
2. Check `.env.example` for R2 and Supabase configuration
3. Review `deploy/cloudflare/wrangler.toml` for Worker bindings
4. Inspect `open_box.artifacts` for existing stored files
5. New tables go in the `open_box` schema with RLS enabled
6. Test R2 connectivity and Supabase metadata consistency
