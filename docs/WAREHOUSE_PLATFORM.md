# Open-Box as a Warehouse Platform

Status: design draft — tracks issues #51–#56.
Last updated: 2026-10-31

## Goal

Turn Open-Box from a file-listing gateway into the owner's **data warehouse**:
one place where every project, app, agent, and machine reads and writes data,
with two-way sync to wherever the data lives (local Mac, cloud servers, mounts,
backups, business apps), and an internal AI agent that operates the whole
lifecycle in natural language.

## Architecture at a glance

```
                        ┌──────────────────────────────┐
 AI agents / ChatGPT /  │  MCP server  /mcp            │  openbox.fs.* tools,
 Composio toolkits ─────►│  (issue #55)                 │  scope-gated
 open-connect agents     └──────────────┬───────────────┘
                                         │
 Third-party apps (OAuth) ──► ┌─────────▼──────────┐
  consent + scoped tokens     │   Open-Box core     │
                              │  REST / WebDAV /S3  │
                              │  FTP / SFTP         │
                              └─────────┬───────────┘
        ┌───────────────┬───────────────┼───────────────┬────────────────┐
   Storages (mounts)  Sync engine    Integrations   AI agent layer   Tasks
   any driver          (#54)          hub (#53)      (#56)            (existing)
        │                  │               │                │
 local Mac agent      cloud servers,   open-connect,   organizer,
 (launchd, WebDAV+    backup targets,  Composio,       automations,
  delta manifest)      S3 buckets      notifications   lifecycle ops
```

## Credential layers (the front door)

Everything external authenticates through one of three layers, all converging
on the same user identity:

1. **Personal access tokens** (#51, PR #58) — machines and agents that act as
   *you*. Scoped (`fs:read`, `fs:write`, `share:read`, `task:read`,
   `task:write`), revocable, hashed at rest. This is what a Composio toolkit or
   a ChatGPT plugin configuration holds.
2. **OAuth 2.0 apps** (#52) — third-party apps that act *on behalf of you with
   consent*. Open-Box becomes an authorization server: app registration,
   `authorize` + `token` (PKCE), refresh rotation, per-app grant management.
   The MCP protected-resource metadata (`server/mcp/oauth.go`) already points
   at this model.
3. **Session JWT / SSO** — unchanged; humans log in as today (OIDC, GitHub
   SSO, LDAP, WebAuthn).

Rule: **a leaked credential must never be able to mint broader credentials.**
PATs cannot manage tokens (#58 enforces session-only token management); OAuth
refresh tokens rotate and are bound to their grant.

## Integrations hub (#53)

A registry of outbound connections, admin-managed:

- `Integration` record: type (`open_connect`, `composio`, `s3`, `webdav`,
  `ftp`, `local_agent`, `notification`), config as encrypted JSON (server key),
  credential reference (PAT id or OAuth grant), health state.
- Health-check worker on the existing task scheduler; status visible in the
  manage UI Integrations page (today that page has no backend — this is it).
- `test-connection` endpoint per integration; failures surface to the AI
  agent for diagnosis.

## Two-way sync engine (#54)

Goal: Open-Box folder `<->` external target, continuous and resumable.

- **Job model** on top of `internal/task`: source, destination, direction
  (up/down/both), include/exclude globs, conflict policy (newer-wins /
  versioned rename / skip), schedule (cron) or watch-driven.
- **Delta protocol**: per-job manifest (path, size, content hash, mtime);
  only changed entries transfer. Resumable; bandwidth-throttled.
- **Targets, in order**:
  1. Local Mac folder — small sync agent (WebDAV + manifest polling, or a
     `open-box sync run --job <id>` CLI under launchd). WebDAV already exists,
     so v1 needs no new protocol.
  2. Storage-to-storage — reuse `internal/fs.Copy` transfer machinery with a
     manifest layer on top.
  3. S3-compatible buckets — rclone lib is already vendored.
- **Conflicts**: default to versioned rename (`name (conflict 2026-10-31).ext`);
  never silently overwrite; journal every decision for the agent to review.

## MCP warehouse surface (#55)

Agents get a real toolset, all scope-gated from #51:

- `openbox.fs.search` — by name/type/size/date, cursor-paginated.
- `openbox.fs.mkdir`, `openbox.fs.upload`, `openbox.fs.copy`, `openbox.fs.move`,
  `openbox.fs.remove` — mutations behind `fs:write`.
- `openbox.storage.list` — mounted storages and capacities.
- `openbox.task.status` — progress/cleanup of background jobs.
- `openbox.sync.run` — triggers a sync job once #54 lands.

Existing tools (`fs.list`, `fs.get`, `fs.link`) stay unchanged.

## Internal AI agent (#56)

In-product assistant (the "Agent Assistant" entry) that operates Open-Box
end-to-end, with human approval gates for destructive actions.

- **Runtime**: server-side orchestrator calling a model through the HillStreet
  model gateway (open-connect) or any OpenAI-compatible endpoint (site
  setting). Tools = the MCP surface + internal admin APIs. The agent can only
  do what the asking user can do.
- **Skills** (prompt + tool packs): setup wizard, organizer (dedupe, taxonomy,
  archive), task creator (offline downloads, copies, syncs), health auditor,
  deploy operator.
- **Automations**: cron schedules + triggers (storage added, task failed,
  quota threshold) mapped to skills; every destructive action lands in an
  approval queue.
- **Lifecycle ops**: validate → plan → execute → verify loops for config
  changes and updates; failures roll back; every step is logged.

Sequencing: #51 → #55 → #53 → #54 → #52 → #56. The agent consumes everything
below it, so it lands last.

## Security invariants

- Raw secrets appear exactly once (creation), stored only as hashes.
- Integration configs encrypted at rest; never returned by the API after write.
- Every external action is attributable: token prefix or OAuth client in logs.
- Guest-accessible routes (`Auth(true)`) never accept mutation scopes.
- New indexes/cache keys justified by query plans and keyed with every input
  that changes the response (tenant/user, scope, path).

## Rollout

1. Merge PAT (#58) → agents and scripts can authenticate today.
2. MCP warehouse tools (#55) → warehouse readable/writable by agents.
3. Integrations hub (#53) → outbound connections managed and healthy.
4. Sync engine v1: Mac agent over WebDAV (#54) → first real 2-way sync.
5. OAuth apps (#52) → third-party ecosystem with consent.
6. Agent layer (#56) → natural-language operation of all of the above.
