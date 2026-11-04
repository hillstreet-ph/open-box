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

**Correction to the premise above, kept because the design still earns its keep.**
The sentence "there is no documented per-deploy mutation that rewrites that tag"
was written from Railway's public docs. Reading the live schema on 2026-11-05
contradicts it: `ServiceInstanceUpdateInput` does expose `source ::
ServiceSourceInput` (alongside `buildCommand`, `dockerfilePath`, `startCommand`,
`registryCredentials`, `healthcheckPath`, `numReplicas`, `region`, and more), so
a per-deploy image rewrite *is* available — the workflow could PUT
`main-<sha>` straight onto the service instead of copying a manifest.

The channel design is kept anyway, for two reasons that are independent of that
schema fact. First, `serviceInstanceRedeploy` re-pulls a tag rather than
selecting a digest, so a per-deploy `source` rewrite would put an image
reference chosen by CI into the deploy path, and the digest-equality proof — the
one check that says "the bytes about to run are the bytes that were tested" —
only exists because a mutable tag is being resolved and then verified. Second,
the rewrite path needs the mutation to be accepted on every build; the copy path
needs one Docker Hub manifest copy that is verifiable from outside Railway. If
you switch to `serviceInstanceUpdate(input:{source:{…}}`, delete this paragraph,
the sentence above, and step 2-3 in the same change, and re-check what the wait
step can still prove.

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
`secrets.RAILWAY_TOKEN`.

This is not caution, it is the shape of Railway's API. Probed on 2026-11-05 with
an authenticated `railway` CLI session, linked to the `open-box` project and its
`production` environment: `mutation{apiTokenCreate(...)}`,
`mutation{projectTokenCreate(...)}` and the `apiTokens` query all return
`INTERNAL_SERVER_ERROR: "Not Authorized"` — with and without the link. Minting a
token is a dashboard action, so no workflow, script or agent can complete this
step for you. (The schema also shows why the *kind* of token matters:
`ApiTokenCreateInput` takes only `{name, workspaceId}` — no expiry, no scopes —
and this workspace holds three projects, so a workspace token would let a CI
runner reach `open-system` and `TGate Worker` too. `ProjectTokenCreateInput`
takes `{projectId, environmentId, name}`.)

Create a **project token** — Railway → the `open-box` project → Settings →
Tokens, scoped to `open-box` / `production` — then pipe it in from your own
terminal:

```sh
read -s RAILWAY_TOKEN && printf '%s' "$RAILWAY_TOKEN" | \
  gh secret set RAILWAY_TOKEN --repo hillstreet-ph/open-box
unset RAILWAY_TOKEN
```

Never paste it into a chat and never pass it as a command-line argument: this
run reads it from an env binding into a 0600 header file and calls curl with
`-H @file`, so the value appears in no process list and no log line.

Every other knob has a working default and needs setting only if you deviate
from this document:

| variable | default | meaning |
| --- | --- | --- |
| `vars.RAILWAY_PROJECT_NAME` | `open-box` | the name the run asserts before writing |
| `vars.RAILWAY_ENVIRONMENT_NAME` | `Production` | environment lookup by name (this repo sets `production`) |
| `vars.RAILWAY_SERVICE_NAME` | `open-box` | service created / looked up |
| `vars.RAILWAY_CHANNEL_TAG` | `railway` | the mutable channel tag |
| `vars.RAILWAY_MOUNT_PATH` | `/opt/openlist/data` | volume mount path |
| `vars.RAILWAY_ORIGIN_URL` | empty | pins the origin instead of domain discovery |
| `vars.SITE_URL` | `https://open-box.space` | written into the service env |
| `vars.CLOUDFLARE_WORKER_NAME` | `open-box-gateway` | the Worker whose `ORIGIN_URL` is repointed |
| `vars.CLOUDFLARE_ACCOUNT_ID` | empty | pins the account instead of probing every readable one |

A missing Railway, Docker Hub or database prerequisite fails the run naming all
of them, without printing any value. Missing Cloudflare credentials do not fail
a promotion: the cutover reports `skipped` and the edge gate says so.

## 3. Provision the service once

Dispatch **`provision and verify`**:

```sh
gh workflow run openbox-deploy-railway.yml --repo hillstreet-ph/open-box \
  -f mode="provision and verify" \
  -f image_tag=main-c098aae \
  -f expected_frontend_asset=index-DXZYoYrc.js \
  -f "rotate_confirmed=yes — allow write"
```

`main-c098aae` (manifest `sha256:c56096c1216992c5a84acdd433c955ef87c04908c76bcc420dd7429992d2ab89`,
published 2026-11-04T21:45Z, read back from Docker Hub on 2026-11-05) is the
current build of `main`, and `index-DXZYoYrc.js` is the v4.2.11 entry asset it
serves — `c098aae..1e7093f` changed no `frontend/` file, so the bundle name
carries over. Replace both with the values for whatever you are actually
shipping, and never trust this paragraph over `git log` and the built asset.

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

## 5. Repoint the edge — CI does this now, and here is what it touches

`open-box.space` is served by the Cloudflare Worker `open-box-gateway`, whose
`ORIGIN_URL` binding still pointed at the dead
`https://open-box-space.zeabur.app` when this was last read (2026-11-05: eight
bindings — `AI`, `AI_CONFIG`, `AI_CONFIG_KEY`, `APP_NAME`, `AUTH_REQUIRED`,
`ORIGIN_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`). Until it changes, the
site stays down even when Railway is healthy.

The workflow now does it for you. `Repoint the Cloudflare Worker at the Railway
origin` runs **after** the Railway half of the gate has passed — it moves the
live public domain, so it will not aim a browser at a container that failed its
own health, token, database or bundle checks. It reads the Worker's settings,
replaces the `ORIGIN_URL` binding alone, and reads everything back:

* the write is a `PATCH /accounts/{account}/workers/scripts/{worker}/settings`,
  `multipart/form-data` with one part named `settings` holding
  `{"bindings":[…]}` as JSON (measured on a throwaway Worker: anything else is
  rejected with code 10001 or 10201);
* the `secret_text` bindings are **omitted** from that payload, which is what
  preserves them — `AI_CONFIG_KEY` seals the provider keys and cannot be read
  back, so any flow that restated the binding list from the repository config
  would destroy it;
* zone routes are a separate resource, and the step re-reads `open-box.space/*`
  afterwards to prove it still belongs to `open-box-gateway`;
* the credential's **header form is negotiated, not assumed**. `CLOUDFLARE_API_KEY`
  has never been exercised from CI, and its name fits two different things: a
  Global API Key travels as HTTP Basic (`email:key`) or as the legacy
  `X-Auth-Email`/`X-Auth-Key` pair, and an API token travels as Basic. The step
  writes both header files under `umask 077`, calls `GET /accounts` with each,
  and uses whichever authenticates — recording `auth_form=basic|legacy` in the
  step outputs. If neither does, it fails before any write and names the two
  secrets to check, rather than reporting a rejected cutover three calls later.

`edge_write` is recorded as `wrote` the moment the PATCH succeeds, before the
read-back guards — so a run that writes and then fails a guard reports that the
edge moved, not that it was skipped.

It needs `secrets.CLOUDFLARE_API_KEY` and `secrets.CLOUDFLARE_EMAIL`, which this
repository already has. Without them the step says `edge_write=skipped` and the
edge gate names that instead of pretending the site is up. Two optional knobs
narrow the discovery: `vars.CLOUDFLARE_WORKER_NAME` (default
`open-box-gateway`) and `vars.CLOUDFLARE_ACCOUNT_ID` (default: probe every
account the credentials can read, and refuse if more than one owns the Worker).

**Why this is not `wrangler deploy`.** [deploy/cloudflare/wrangler.toml](../cloudflare/wrangler.toml)
has no `routes` and no `workers_dev` key, so it does not declare how the Worker
is routed, and it carries fewer bindings than are live — `AI_CONFIG_KEY` and the
sealed provider configuration are not in it. A CI `wrangler deploy` would upload
that smaller config over the running Worker and could detach the route from an
already-down site. The settings PATCH changes one value and leaves the rest of
the live config alone, which is the whole reason it was chosen. `npx wrangler
deploy` remains the right tool when you have deliberately changed the code or the
committed bindings — from a terminal, after reading `npx wrangler deployments
list` and the dashboard's domain/route entries.

Re-check TLS afterwards, then consider the apex DNS record: `open-box.space`
still carries a proxied CNAME to the retired host. Traffic follows the Worker
binding, not that record, so it is a cleanup item, not a switch. Once the
Railway service domain is stable and you own a custom domain on the service,
point the record there and update `ORIGIN_URL` to match.

**Rolling the edge back is not a recovery.** The old origin is the retired Zeabur
host, which answers nothing; repointing the Worker back at it restores an outage
rather than a service. If a promotion is bad, roll the **channel tag** back at
the previous digest (step 4's report prints the command) and re-run — the Railway
service domain does not change between builds, so the cutover step reports
`unchanged` and leaves the edge alone.

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

Forty-nine assertions cover channel-digest equality in both directions, the
retired-id refusal, the rotation attestation gate and its verify-only exemption,
bindings reporting without value leakage, the malformed-binding refusals (a
project id carrying JSON metacharacters, a channel tag carrying a slash),
provisioning detail (volume, `/ping`, domain, DSN never logged), the wait step's
refusal to accept a
`SUCCESS` that serves a stale bundle, `CRASHED` abort, every gate rejection
path, and the cleanup step deleting each credential file. The edge block covers
the Cloudflare cutover against `mock_cloudflare.py`: that the settings PATCH
replaces `ORIGIN_URL` alone while the `ai`, `kv_namespace`, `secret_text` and
other `plain_text` bindings survive; that an already-correct origin issues no
PATCH; that `verify only` writes nothing; that a missing or secret-shaped
`ORIGIN_URL` binding is refused rather than guessed; that account ownership is
probed when nothing is configured; that a rejected PATCH, a detached zone route
and an unreadable zone each produce their own honest outcome; that the step
negotiates which credential form the secret actually holds instead of assuming
one (Basic rejected once, the legacy pair used for every call after it; both
rejected means no write at all); and that no credential reaches a log in any
form — including its base64 encoding, which is what a Basic header actually is.
It needs `python3`,
`ruby` (for the YAML extraction) and `jq`.
