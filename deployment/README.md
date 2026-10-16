# Fixed Linux deployment and offline release tooling

This profile is disabled until a separately provisioned Linux runner qualifies
real release artifacts. Nothing here starts the developer's existing stack.
Never run this profile against the original development database.

## Provisioning boundary

`compose.yml` is trusted installed host configuration, never release media.
It joins an existing, isolated `CRA_BACKEND_NETWORK`. The pinned PostgreSQL,
Auth, REST, Storage and Supabase gateway must already be provisioned there under
`auth`, `rest`, `storage`, `gateway` names. Their images, database volumes and
credentials are installation configuration outside release directories. They
must publish **no customer-reachable ports**. The fixed edge is the sole public
entry point, including Auth, REST, Storage and agent TLS. A deployment with a
second route to any writer is unmanaged and must fail upgrade preflight.

`service-inventory.json` lists every known executable application entry point.
The host supervisor must compare installed services and live writers to it;
unknown services or missing drain evidence block upgrades. `workers` enables
continuous workers. `maintenance-tools` contains original one-shot exports and
vault tools: invoke explicitly with their existing required CLI arguments; they
are not new background jobs. `backup-control` is separately privileged and needs
its pre-existing reviewed backup configuration, exact private mounts, Docker
permissions and instance credentials. Never enable that profile merely to make
an upgrade preflight pass. Normal API/web containers have no Docker socket or
private supervisor credentials. `control` exposes the existing operator realm
on loopback for the separately authenticated host ingress; it is not public.
The independent upgrade supervisor remains an installed host service outside
this application's Compose project.

Provision `deployment/local/` from `examples/` locally with restrictive owner
permissions. Place real credentials only there or in mounted secrets. Example
values intentionally cannot deploy. Replace every image value with an exact
qualified local `sha256:<64 lowercase hex>` Docker config-image ID already loaded into
Docker. Apply never builds or pulls. Do not run `compose down -v`, database reset,
queue cleanup or restore as an upgrade/rollback step.

## Building release images

Build on a dedicated Linux release builder using Node 22 and pnpm 10.33.4. Supply
reviewed digest-pinned `NODE_IMAGE`, `STATIC_IMAGE` and `POSTGRES_TOOLS_IMAGE`
arguments to `deployment/Dockerfile` (builder-local examples are in
`deployment/examples/build.env`). Targets include `api`, `web`, `agent`, `operator`, `edge`
and the separate `control` image. The shared API/worker image builds libxml2 native
bindings; the pinned remote-agent image builds native SQLite. Runtime includes
libxml2, OpenSSL, CA certificates, tar and Docker CLI without credentials/socket.
The operator image serves its real `out/` static export.

Signed application media replaces **only `api` and `web` image roles**. Agent
ingress and all listed API workers use `api`. The independent operator/private
control realm, edge, supervisor and remote-agent client remain pinned outside
application replacement. Their inventory and compatibility must still pass
preflight; listing them does not implicitly authorize upgrading them.

Web images compile only the fixed live flag `NEXT_PUBLIC_ENABLE_MOCKS=false` and
the same-origin `/api/v1` rewrite to `http://api:3333`. No installation public URL
is baked into the image. Configure server-only runtime
`SUPABASE_INTERNAL_URL=http://gateway:8000` and `API_ORIGIN=http://api:3333` in
`local/web.env`. The internal Supabase origin drives both JWKS retrieval and the
verified token issuer, and must match the API's `SUPABASE_URL` and configured
GoTrue issuer. Existing public/server/local fallbacks remain available for
development. Algorithm-aware ES256/RS256 verification, issuer checks and signature
failure behavior remain unchanged. Keep secrets outside `NEXT_PUBLIC_*`. Test
owner authentication against the actual built image.

## Persistent maintenance handshake

Create `/var/lib/cra-maintenance` outside release/data/media/restore roots and
provision permissions for the fixed supervisor and installed runtime UID. Only the supervisor may write its `control/` directory. Each service mounts
`control/` read-only and only `acks/<serviceId>/` read-write; it cannot reopen
the gate or forge another service acknowledgement. The supervisor atomically publishes
and fsyncs `control/request.json` with `{version:1,generation:<UUID>,closed:true}` before
stopping anything. Edge rejects every customer request and new agent socket.
Existing HTTP responses and agent streams must finish before the edge writes
`acks/edge/ack.json`; process/socket termination is not a substitute for drain.

Every worker uses the same mounted generation gate before a complete source
operation, retaining its original durable source outcome. API/agent HTTP leases
span response finish/disconnect. Agent source leases span its source+heartbeat
cycle. `CRA_MAINTENANCE_ACK_DIRECTORY` names the per-service private ACK mount.
Per-service `acks/<serviceId>/ack.json` acknowledgements contain version, generation, serviceId, pid,
`claimsClosed:true` and `drained:true`; they are written only after zero active
operations. Read errors, malformed requests, unknown work and missing services
never prove drain. ACKs for an earlier generation/process are stale. Exact
internal GET `/api/v1/health` and `/api/v1/health/ready` remain available to private
candidate probes; the edge still blocks them publicly. The supervisor journals
exposure intent before reopening the gate or restarting claims. A host reboot
must retain the closed request until explicit reconciliation.

## Signing offline releases

Build contracts first. `tools/upgrades/package-release.mjs` takes exactly three
arguments: reviewed config JSON, a private Ed25519 key file, and a **new** output
directory. The key must be a regular non-symlink file readable only by its owner;
key material never appears in argv or output. Use an ephemeral test key for tests.
Do not add production signing keys to this repository.

The config contains `kid`, `manifest` (all reviewed release metadata except the
computed inventory/archive), `images:[{service,digest,path}]`,
`migrations:[{path}]`, and `sbomPath`. The mandatory CycloneDX SBOM contains actual
components from the built release. Image archives must come from the qualified
platform image export; supplied digests are independently checked when staging.
Migration SQL must already have passed compatibility review; packaging does not
certify arbitrary SQL as safe. Supported image roles follow the shared manifest
schema; the fixed inventory expands the shared API image to worker entrypoints.

The tool snapshots inputs, computes exact hashes and byte counts, creates a flat
POSIX `payload.tar`, and writes `manifest.json` plus compact `release.jws` with
`EdDSA`/`CRA-RELEASE+JWS`. The signed manifest binds the payload, every image,
every migration and the mandatory SBOM. Only `release.jws` and `payload.tar` are
mounted as candidate media. No scripts or Compose files enter the archive. The
private snapshot directory is packaging evidence, not runtime media. An error
leaves incomplete output for inspection and never overwrites an earlier release.

## Truthful N/N-1/N-2 qualification

`tools/upgrades/qualify-release.mjs request.json NEW_RESULT.json` now always calls
the fixed repository `reference-runner.mjs`. It accepts no arbitrary runner
executable. The manually dispatched `m15-06-reference-qualification.yml` requires
the `self-hosted`, `linux`, `cra-dedicated-qualification` labels and protected
`cra-reference-qualification` environment. Never dispatch it automatically.

Pre-provision a dedicated host, local real artifacts and an isolated
`/var/lib/cra-qualification` directory. Set `CRA_DEDICATED_QUALIFICATION_RUNNER=true`
and an independent `CRA_QUALIFICATION_RUNNER_ID`. Remote Docker endpoints and
cloud Supabase credentials are rejected. The request contains exactly three
`releases` with generations `N`, `N-1`, `N-2`. Every release has `fixtureTemplateDirectory` plus **source** and
**target** objects, each containing `payload` and `signature` objects with
absolute `path` and exact `sha256`. The runner reads/hashes all six source-target
pairs before any Compose action.

The runner uses the shipped `tools/upgrades/native-reference-fixture.mjs` factory.
Each release supplies `fixtureTemplateDirectory`, an absolute path to an operator-
provisioned local template directory. Each scenario materializes a **new** private
profile under the unique task root, replacing only `__CRA_PROJECT__` and
`__CRA_ROOT__` tokens in text configuration. No template symlinks or special files
are accepted. Seeded database/object/checkpoint files remain local fixture assets;
no original source volume or network is imported.

The directory contains `fixture.json` (shape in
`deployment/examples/reference-fixture.json`), a fixed Compose profile, a strict
supervisor mount/composition JSON, local release trust, private grant/control/
journal/selection keys, independently signed installed and qualification receipts,
seeded disposable database/object initialization, backup authority/checkpoint,
and actual localhost TLS/mTLS certificates. Signed installed and qualification
receipts use the native inspector's current exact schemas: both bind
`sourceImageIds` for `api`/`web` and `sourcePlatform`; qualification additionally
binds `targetLedgerDigest`, target schema and candidate config-image IDs. These are **external provisioning
prerequisites**, not a missing code module. Missing files, unsigned/mismatched
source checkpoints, remote/source authority, mutable images, or unavailable
native binaries produce an actionable `reference_fixture_prerequisite` failure
and no qualification result. The factory uses the actual built supervisor runtime
schemas, media verifier, exact-image loader and authenticated Unix IPC client.

The fixed runner validates the normalized Compose profile, loads only verified
source/target images, and starts the unique scenario project with
`--pull never --no-build`. It waits for real source/DB/mTLS metadata readiness.
The native driver sends actual stage, preflight, fingerprint-bound apply,
reconcile and compatible rollback commands and reads actual run state/container
image IDs. Faults stay inside the disposable fixture: withholding its own ACK
write permission forces drain refusal; an unreachable candidate health endpoint
forces pre-exposure image rollback; supervisor restart and a dropped apply reply
exercise reconciliation. The owner flow signs in through actual TLS, retains
session cookies and requests dashboard navigation. Egress denial attempts an
actual TCP connection from the isolated API container. Returned pass booleans
cannot replace native observations.

Each case binds the request digest, unique run ID, generation, actual observations
and monotonic duration under **30 minutes (1,800,000 ms)**, including provisioning
and startup; overruns fail qualification. The runner samples 100 actual mTLS
metadata reads after each generation's forward upgrade and reports nearest-rank
p95/p99/max. All fixture resources and evidence remain available for independent
review, with no automatic data cleanup/reset/down-volume operation. No real
reference qualification was executed in the shared development workspace.

The `control` Dockerfile target is separate from normal API/web. It includes Linux
flock, Docker CLI, PostgreSQL **17** client tools and an independently verified
local Linux Supabase CLI binary. `POSTGRES_TOOLS_IMAGE` is required with an exact
`repository@sha256:<64 lowercase hex>` reference to the reviewed PostgreSQL 17
image matching the fixed Supabase runtime. The control target copies its complete
`/nix` closure and links `/usr/bin/psql` and `/usr/bin/pg_dump` to
`/nix/var/nix/profiles/default/bin/`. Copying the closure retains the tools' ELF
loaders and shared-library dependencies. Both executable version probes must
report major 17 or the image build fails. There is no Bookworm PostgreSQL 15
package fallback, mutable runtime download, or PostgreSQL tool closure in the
normal API/web images. Provision that binary at `deployment/control-tools/supabase`
on the isolated builder, supply its reviewed `SUPABASE_BINARY_SHA256`, and do not
commit it. The build fails if the binary/hash is missing; it never downloads a
mutable replacement. The supervisor runs only with separately provisioned private
mounts and Docker authority. No real reference qualification is claimed by unit
tests or hosted CI.
