# Open-Box on Railway

Production runtime for `open-box.space` after the Zeabur migration (issue #28).
The workflow that delivers it is
[`.github/workflows/openbox-deploy-railway.yml`](../../.github/workflows/openbox-deploy-railway.yml);
this file is the operator runbook around it. Read [deploy/PRODUCTION.md](../PRODUCTION.md)
for the topology and the required runtime variables.

**Status as of 2026-11-05:** the Railway project **exists** (`open-box`,
`b65f4f52-404d-4dcb-be94-14a76f9d55ff`, workspace "Kobeplay Workspace", billing
active and under its limit) and `vars.RAILWAY_PROJECT_ID` plus
`vars.RAILWAY_ENVIRONMENT_NAME` are set on the repository. The service inside it
does not exist yet, and `secrets.RAILWAY_TOKEN` is not set — CI cannot write to
Railway until you add that token (step 2). Until then `open-box.space` stays
down: the edge still points at the retired Zeabur origin, and both are unreachable
(re-checked 2026-11-05 — `https://open-box.space/` times out after 15s, and
`https://open-box-space.zeabur.app/` times out at the TCP connect). Steps 3
onward are blocked on that one credential; nothing here is verified as serving.

## How a build gets onto the service

Railway's documented image source pins a tag, and there is no documented
per-deploy mutation that rewrites that tag. So the workflow does not pretend
otherwise:

1. `Open-Box Docker Hub` already publishes an immutable
   `hillstreet/open-box:main-<7-char-sha>` per merge to `main`.
2. The promotion run copies that manifest onto the dedicated channel tag
   `hillstreet/open-box:railway` with `docker buildx imagetools create` — a
   manifest copy, no rebuild.
3. The run polls Docker Hub and **refuses to continue unless the channel digest
   equals the promoted build's digest.** A channel that resolves to anything else
   means the thing about to be deployed is not the thing that was tested.
4. `serviceInstanceRedeploy` makes Railway re-pull the channel digest.
5. The wait step only clears when the deployment id is new, its status is
   terminal-success, **and** the service domain actually serves the entry asset
   named in `expected_frontend_asset`. A `SUCCESS` for the deployment that was
   already serving does not count.
6. The production gate then probes both hops (see "What the gate proves" below).

The channel tag is the only mutable artifact in this design. It is used by no
other service, and every run records the immutable tag and digest behind it, so
a rollback is a channel re-copy rather than a rebuild.

## 1. Create the Railway project

Done on 2026-11-04, recorded so the state is legible rather than magical:

```sh
railway init --name open-box --workspace <workspace-id> --json
```

That created project `b65f4f52-404d-4dcb-be94-14a76f9d55ff` in the workspace the
owner's Railway account uses, whose billing is active and under its limit. The
CLI names the default environment **`production`** (lowercase), which is why
`vars.RAILWAY_ENVIRONMENT_NAME=production` is set; a dashboard-created project
would instead use `Production`, the workflow's default. The workflow asserts the
project *name* before any write and refuses the retired Zeabur identifier
`ymhiwerqyegvondndkjn` outright, so a wrong binding is visible in the log.

Do not create the service by hand — step 3 lets the workflow do it, so the
volume, healthcheck and domain are configured identically every time.

## 2. Store the Railway token (human, from your own terminal)

Already bound on 2026-11-04: `secrets.SUPABASE_DB_URL`, `secrets.DOCKERHUB_USERNAME`,
`secrets.DOCKERHUB_TOKEN`, `vars.RAILWAY_PROJECT_ID` and
`vars.RAILWAY_ENVIRONMENT_NAME`. The one binding that no agent can create is
`secrets.RAILWAY_TOKEN`: a Railway API token is minted by an account holder, and
a token that passed through a chat transcript or a command line is a leaked
token. Create one at Railway → Account → Tokens (scoped to the `open-box`
project), then pipe it in from your own terminal:

```sh
read -s RAILWAY_TOKEN && printf '%s' "$RAILWAY_TOKEN" | \
  gh secret set RAILWAY_TOKEN --repo hillstreet-ph/open-box
unset RAILWAY_TOKEN
```

Every other knob has a working default and needs setting only if you deviate
from this document:

| variable | default | meaning |
| --- | --- | --- |
| `vars.RAILWAY_PROJECT_NAME` | `open-box` | the name the run asserts before writing |
| `vars.RAILWAY_ENVIRONMENT_NAME` | `Production` | environment lookup by name |
| `vars.RAILWAY_SERVICE_NAME` | `open-box` | service created / looked up |
| `vars.RAILWAY_CHANNEL_TAG` | `railway` | the mutable channel tag |
| `vars.RAILWAY_MOUNT_PATH` | `/opt/openlist/data` | volume mount path |
| `vars.RAILWAY_ORIGIN_URL` | empty | pins the origin instead of domain discovery |
| `vars.SITE_URL` | `https://open-box.space` | written into the service env |

A missing prerequisite fails the run naming all five of them, without printing
any value.

## 3. Provision the service once

Dispatch **`provision and verify`**:

```sh
gh workflow run openbox-deploy-railway.yml --repo hillstreet-ph/open-box \
  -f mode="provision and verify" \
  -f image_tag=main-1e7093f \
  -f expected_frontend_asset=index-DXZYoYrc.js \
  -f "rotate_confirmed=yes — allow write"
```

`main-1e7093f` (manifest `sha256:439c9214…`) and the v4.2.11 entry asset
`index-DXZYoYrc.js` are the current build and the current frontend release;
replace both with the values for whatever you are actually shipping.

It creates the service pinned to the channel tag, then writes the runtime
variables (`SITE_URL`, `PUBLIC_DOMAIN`, `TZ`, `UMASK`, `DB_TYPE`,
`DB_TABLE_PREFIX`, `DB_DSN`, `RAILWAY_RUN_UID`), a volume at
`/opt/openlist/data`, the `/ping` healthcheck with a 300s timeout and
`ON_FAILURE` restart, and a public service domain. It prints key names only — the
DSN reaches the API from a `0600` file, never a command line.

`RAILWAY_RUN_UID=0` is a real reduction in container isolation, made because the
image runs as uid 1001 while Railway mounts its volume root-owned, so the
entrypoint writability check aborts the container otherwise. If you know a
non-root fix, change the workflow and this sentence together.

If the volume or healthcheck mutation is rejected by the API, the run emits a
visible `::warning::` and tells you to set it in the dashboard. It does not
pretend either succeeded.

## 4. Promote per build

Dispatch **`promote and verify`** with `image_tag` set to the immutable tag and
`expected_frontend_asset` set to the entry asset that build is known to serve.
Blank `image_tag` keeps the current channel build; blank `expected_frontend_asset`
emits a warning rather than silently skipping the identity check.

**`verify only (no write)`** runs the gate against whatever is already deployed
and needs no rotation attestation. Use it for status checks.

## 5. Repoint the edge — this is the step that brings the site back up

`open-box.space` is served by the Cloudflare Worker `open-box-gateway`, whose
`ORIGIN_URL` binding still points at the dead
`https://open-box-space.zeabur.app`. Until you change it, the site stays down
even when Railway is healthy — and a failing edge check in a promotion run means
exactly this, not an application defect. The gate says so in its own error text.

There is no CI path for this Worker. Edit [deploy/cloudflare/wrangler.toml](../cloudflare/wrangler.toml):

```toml
ORIGIN_URL = "https://<the railway service domain printed in step 3>"
```

then deploy from this directory:

```sh
cd deploy/cloudflare && npx wrangler deploy
```

Re-check TLS afterwards, then consider the apex DNS record: `open-box.space`
still carries a proxied CNAME to the retired host. Traffic follows the Worker
binding, not that record, so it is a cleanup item, not a switch. Once the
Railway service domain is stable and you own a custom domain on the service,
point the record there and update `ORIGIN_URL` to match.

## 6. Verify

The run itself is the verification. What the gate proves, in order: `/ping`
answers `pong`; the token discriminator route is routed (not SPA fallback HTML);
`/api/public/settings` reports `site_name` equal to `Open-Box`, which is what
separates a service reading the production Postgres from one that booted its own
local sqlite database; the origin serves the named entry asset; an anonymous
`/api/fs/list` answers (or is recorded as auth-gated, which is a valid
configuration); TLS verifies on both the Railway hop and the edge hop; and the
edge serves the same named bundle.

What it does **not** prove, and remains open: a signed-in session surviving a
redeploy, storage read/write through the new runtime, and the `x_*` tables
living in `public` rather than the intended `open_box` schema.

## Rollback

Re-copy the channel tag onto the previous known-good digest — the summary of
each run prints the exact command, the before-digest and the immutable tag it
replaced:

```sh
docker buildx imagetools create \
  -t hillstreet/open-box:railway \
  hillstreet/open-box@sha256:<previous digest recorded in the summary>
```

Then re-dispatch `promote and verify` with that build's `image_tag` and
`expected_frontend_asset`, so the gate re-proves the rollback instead of
assuming it. Keep the old `openbox-deploy.yml` Zeabur workflow files as the
historical record; they are no longer a delivery path and must not be pointed
at the retired project.

## Local harness

The step bodies are executed against a mock Railway GraphQL API and a mock
origin, not transcribed, so a green harness is evidence about the shipped
workflow rather than about a copy of it:

```sh
bash deploy/railway/harness/run_tests.sh
```

Thirty-one assertions cover channel-digest equality in both directions, the
retired-id refusal, the rotation attestation gate and its verify-only exemption,
bindings reporting without value leakage, the malformed-binding refusals (a
project id carrying JSON metacharacters, a channel tag carrying a slash),
provisioning detail (volume, `/ping`, domain, DSN never logged), the wait step's
refusal to accept a
`SUCCESS` that serves a stale bundle, `CRASHED` abort, every gate rejection
path, and the cleanup step deleting each credential file. It needs `python3`,
`ruby` (for the YAML extraction) and `jq`.
