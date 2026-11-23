# Tencent COS and DTS — Singapore integration and skills

**Status: evidence + agent guidance installed; provider-side migration NOT configured or deployed.**

## Tencent account evidence from connected console tabs

| Console resource | Observed state | Action |
|---|---|---|
| COS `open-box-backups-1531773422` | Private Read/Write bucket ACL; static website OFF | Keep private; inspect bucket versioning/encryption/retention, account quota and actual objects before any backup |
| COS `open-box-tokenhub-datalake-1531773422` | File-compression task is **Running at 0%** (2026-11-23 console observation) | Wait for independently verified completion and compare object checksums; a zip task is not a migrated database |
| DTS `dts-g24p3lhq` (`master-migration`) | Singapore, PostgreSQL→PostgreSQL, **Creation completed**, Medium, **Pay as you go**, Configure/Verify available | **Do not execute or add** migration task while billing/free allowance, source and destination are not verified |
| Guangzhou DTS | Zero tasks in selected region | Leave unchanged; Singapore is target default |

Full observed fields: `../inventory/tencent-cos-dts-2026-11-23.json`. Browser tab labels such as "[Task completed]" and "[Action needed]" are not evidence of task completion or failure.

## Data engineering skills installed for Codex and OpenCode

Source: https://github.com/vaquarkhan/data-engineering-agent-skills/blob/main/skills-index.md

- `data-migration-and-platform-cutover` — staging, reconciliation, canary, rollback
- `data-quality-and-contract-testing` — contracts, source-to-target data quality
- `data-lake-and-zone-architecture` — COS zone and retention conventions
- `orchestration-and-backfills` — safe resumable jobs and idempotent checkpoints

Command `npx skilldb search "data engineering"` was also run successfully on the already-connected development device. SkillDB returned 477 search matches, not installations. See https://skilldb.dev/skills/data-engineering-skills for an alternative curated pack with overlapping skills. Do not bulk-install all matches or assume these skills grant cloud API access.

The four source-repository skills are installed as shared `~/.agents/skills/<name>/SKILL.md` entries, with verified symlinks for Codex (`~/.codex/skills/`) and OpenCode (`~/.config/opencode/skills/`). These are local **skill instruction files**, not local migration workers or production runtime.

## Guarded deployment work items

1. Authenticate Tencent COS in an approved credential vault or OAuth-capable connector; do not use previously pasted credentials. Confirm bucket ownership and Singapore region through a signed read-only call.
2. Record exact COS permissions, private ACL, SSE, versioning, lifecycle, object count, used bytes and costs. Do not turn on static website hosting for private backups.
3. Reconcile current Open-Box Railway volume actual bytes with existing Supabase `open-box-backups` objects. A volume backup is separate from Supabase database backups.
4. Inspect whether DTS task `dts-g24p3lhq` is billable upon configuration/start. Do not start/duplicate a **pay-as-you-go** Medium job under a free-only policy.
5. Data warehouse: COS holds object datasets, Supabase remains transactional Postgres, Databricks requires a verified warehouse/catalog and independently approved compute budget. Never treat COS as a SQL engine.
6. Only after read-only inventory, tested restore and verified budget, enable encrypted resumable transfers with checkpoints and checksums; preserve Railway and Postgres source unchanged through rollback.
7. No Cloudflare origin changes, untrusted scripts, opened firewall ports, storage deletions, paid resources or automatic DTS execution are included in this PR.

## References

- https://www.tencentcloud.com/pt/document/product/1332/84177 (user-supplied documentation URL; full content not verified from web)
- https://www.tencentcloud.com/document/product/1332/83772 (user-supplied documentation URL; full content not verified from web)
- https://www.databricks.com/blog/data-engineering-for-ai (data lineage, quality and provenance practices)
- https://vaquarkhan.github.io/data-engineering-agent-skills/
- https://skilldb.dev/skills/data-engineering-skills

**Limitations:** The connected Browser plugin in Chat mode can inspect tabs but cannot click, enter settings or configure production provider UI. No usable Tencent COS/DTS API connector has been verified yet. This document is a staged plan, not proof of operational ETL.
