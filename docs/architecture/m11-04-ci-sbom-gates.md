# M11-04 CI SBOM intake and build status

This integration associates an existing CycloneDX or SPDX SBOM with one owner-approved product release. It reuses the M3 immutable source, validation, provenance, idempotent job, and matching flow. It does not generate SBOMs, change the vulnerability policy engine, or issue a regulatory verdict.

## Contract and trust boundary

An organization owner configures a provider connector, stores its provider credential in the connector vault, creates an M3 CI credential, then creates a release binding at **Connectors → CI SBOM bindings**. A binding records the connector, stable provider repository/project identity, exact allowed Git ref, product, release, and CI credential. The server verifies the connector, provider run, repository/project/pipeline scope, ref, and current access before reserving intake. The CI caller sends only `bindingId`, `runId`, `runAttempt`, file metadata, and an idempotency key. Display names, branch text supplied by the caller, and a client “trusted” flag cannot authorize reassignment.

| Endpoint | Caller | Purpose |
| --- | --- | --- |
| `GET/POST /api/v1/sbom-ci-bindings` | Owner session | List and create scoped release bindings. |
| `POST /api/v1/sbom-ci-bindings/:bindingId/revoke` | Owner session | Revoke with expected version and idempotency key. |
| `GET /api/v1/sbom-ci-bindings/:bindingId/runs?limit=20` | Owner session | Bounded recent run/source/job status without CI secrets. |
| `POST /api/v1/ci/sbom-build-uploads` | Bound CI credential | Reserve immutable M3 source and correlate the provider run. |
| `POST /api/v1/ci/sbom-build-uploads/:sourceId/complete` | Bound CI credential | Complete upload and queue M3 processing. |
| `GET /api/v1/ci/sbom-build-gate?bindingId=…&runId=…&runAttempt=…` | Bound CI credential | Poll a nonpassing build status. |

`pending` means ingestion or matching has not finished, `error` means failed or unavailable, and `policy_not_configured` means the work is ready but there is no approved build policy owner/criteria. The policy identifier is `unconfigured`; **no state in M11-04 passes the CI gate**. Upload and status are separate steps so upload can succeed while a gate job fails closed. The old `/api/v1/ci/sbom-uploads` contract remains available.

## Provider coverage and setup

| Provider | Supported target | Owner configuration | CI setup |
| --- | --- | --- | --- |
| GitHub Actions | GitHub.com REST API `2022-11-28`; GitHub Enterprise Server is unverified. | Install a GitHub App only on intended repositories. Grant repository **Actions: read** to verify the run and **Contents: read** to resolve an allowed lightweight or annotated release tag to the run commit; Metadata: read is implicit. Bind installation and repository database IDs. No PAT. Installation tokens can be scoped to selected repositories and expire after one hour ([permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app?apiVersion=2022-11-28), [tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)). | Store the CRA CI token as an Actions secret. Call the local action only after an authorized `push` or `release` build has produced an SBOM. `workflow_dispatch`, pull requests, forks, and other events are unsupported and rejected before upload. Keep `pull_request_target` away from untrusted checkout ([GitHub guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)). |
| GitLab CI | GitLab.com and approved self-managed 17+ hosts. Components became generally available in 17.0 ([GitLab components](https://docs.gitlab.com/ci/components/)). | Use a project-scoped access token and bind stable project ID and exact host. For 19+ use signed webhook tokens; earlier token-header webhooks require API refetch before authority ([GitLab webhook guide](https://docs.gitlab.com/user/project/integrations/webhooks/)). | Store the CRA CI token in a protected, masked variable. Include the template pinned to a commit/tag and use only `push` pipelines. `web`, `schedule`, merge request, and other pipeline sources are rejected before upload because the adapter does not verify them. Protect variables from forks ([GitLab variables](https://docs.gitlab.com/ci/variables/)). |
| Azure DevOps | Azure DevOps Services Build REST API 7.1; Azure DevOps Server is unverified ([Build API](https://learn.microsoft.com/en-us/rest/api/azure/devops/build/builds/get?view=azure-devops-rest-7.1)). | Bind organization, team project, repository ID, pipeline definition ID, and exact ref. Keep the service connection authorized only for the intended pipeline ([Microsoft guidance](https://learn.microsoft.com/en-us/azure/devops/pipelines/library/service-endpoints?view=azure-devops)). The connector vault needs a project-scoped bearer with Build/service-endpoint read access; rotate it before expiry. This release has no automatic workload-identity exchange and must not use a broad PAT. | Inject the separate CRA CI token as a protected secret pipeline variable from the approved secret store. Use the YAML template after SBOM generation. Only `IndividualCI`, `BatchedCI`, and `Manual` build reasons are supported. `Schedule`, PR, and other reasons are rejected before upload. |

The templates and runner live at `.github/actions/cra-sentinel-sbom-gate/action.yml`, `.gitlab/ci/cra-sentinel-sbom.yml`, `azure-pipelines/cra-sentinel-sbom-gate.yml`, and `tools/ci/cra-sentinel-sbom-gate.mjs`. The GitLab and Azure templates invoke that script from the checked-out repository; copy or vendor it with the template. None contains a secret. Upload the GitHub App PEM through the connector detail's private-key file control; its contents are sent directly to the vault and are not displayed after saving. For all providers, set `CRA_SENTINEL_BINDING_ID` to the owner-created binding ID and `CRA_SENTINEL_CI_TOKEN` in the provider secret store. Set the HTTPS API origin and path to an **existing** SBOM. The runner enforces a 30-second API timeout, 60-second storage timeout, and bounded gate polling; retries use a deterministic key from binding/run/attempt/SBOM hash. GitLab and Azure templates send attempt `1`; GitHub uses the platform's run attempt.

### GitHub workflow example

```yaml
on: [push, release]
jobs:
  sbom:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      # Generate an SBOM in your approved build process before this step.
      - uses: ./.github/actions/cra-sentinel-sbom-gate
        with:
          api-origin: https://cra.example.com
          ci-token: ${{ secrets.CRA_SENTINEL_CI_TOKEN }}
          binding-id: ${{ vars.CRA_SENTINEL_BINDING_ID }}
          sbom-path: dist/firmware.cdx.json
          declared-format: cyclonedx
```

### GitLab job example

```yaml
include:
  - local: .gitlab/ci/cra-sentinel-sbom.yml

cra_sentinel_sbom:
  extends: .cra-sentinel-sbom-gate
  variables:
    CRA_SENTINEL_API_ORIGIN: https://cra.example.com
    CRA_SENTINEL_BINDING_ID: $CRA_SENTINEL_BINDING_ID
    CRA_SENTINEL_SBOM_PATH: dist/firmware.cdx.json
    CRA_SENTINEL_DECLARED_FORMAT: cyclonedx
```

### Azure pipeline example

```yaml
steps:
  - template: azure-pipelines/cra-sentinel-sbom-gate.yml
    parameters:
      apiOrigin: https://cra.example.com
      bindingId: $(CRA_SENTINEL_BINDING_ID)
      sbomPath: dist/firmware.cdx.json
      ciTokenVariable: CRA_SENTINEL_CI_TOKEN
      declaredFormat: cyclonedx
```

## Verification and rollout

| BRD requirement | Evidence required before marking provider complete |
| --- | --- |
| FR-INT-001/002, p51 inbound identity and SBOM | Provider fixture contract verifies stable provider identity, exact ref, trusted event, tenant binding, duplicate/renamed/transferred/revoked behavior; local simulator upload → M3 processing → status. |
| FR-INT-003/004, p51 findings and gate output | Existing findings remain reachable; pending/error/unconfigured status is correlated to run/source/job and never passes. |
| FR-INT-005/006, p55 integration UX and operations | Owner create/revoke/list/recent runs, forbidden/offline/conflict/retry states, keyboard and accessibility checks, screenshot, and provider configuration instructions. |

Run `node --test tools/ci/cra-sentinel-sbom-gate.test.mjs`, focused contract/API/web tests, local SQL authorization tests, `pnpm verify`, and the local Playwright journey. Record separate GitHub/GitLab/Azure fixture results and external sandbox checklist results. Simulator results do not establish live-provider compatibility. Keep reads of Supabase scoped to local `project_id=cra`; do not use unrelated cloud projects. Do not reset or delete user data.

The additive migration is deployed before API/UI/templates. To roll back, remove the new API/UI/templates while leaving binding/run tables and immutable M3 evidence for audit. Disable the CI steps or restore their previous configuration before removal; dropping the tables is a separate retention decision. Live provider credentials and webhook signing secrets must be rotated through their existing vault/secret store, never copied into logs or screenshots.

## Local completion evidence and limits

On 2026-09-30, `pnpm verify` and the full local infrastructure SQL suite passed. Provider adapter fixtures passed for all three vendors (48 tests), and the CI runner/template checks passed (6 tests). The scoped local simulator in `apps/api/test/m11-04-ci-live.ts` completed signed upload, M3 ingestion, vulnerability matching, and a `policy_not_configured` gate response. It also checked replay identity, tenant substitution, owner run correlation, and exact fixture cleanup. Thirty authenticated local gate reads at concurrency three measured p95 93.1 ms and p99 93.3 ms against the 400/1000 ms targets. This is a development-server sample, not production load evidence.

The local Supabase Storage 1.67 schema lacks the nonpartial `(name,bucket_id)` uniqueness required by signed upload. The simulator installs a temporary index only in the local `cra` project and removes it in `finally`; it confirmed the index catalogue and fixture organization were restored. M11-04 migrations and generated type copies align with local `cra`; the broader schema diff has preexisting non-CI drift. Supabase MCP lists only unrelated ERP cloud projects, so no cloud database was inspected or changed.

Playwright MCP screenshots from the local owner session: [CI bindings desktop](evidence/m11-04-ci-bindings-empty.png), [CI bindings mobile](evidence/m11-04-ci-bindings-mobile.png), [GitHub App setup](evidence/m11-04-github-app-setup.png), [GitLab setup](evidence/m11-04-gitlab-setup.png), and [Azure setup](evidence/m11-04-azure-setup.png). The local browser auth-refresh, access-revocation, and M11 connector-hub journeys passed with aligned test origins. The M11 journey used a temporary process-only vault keyring because the local API `.env` does not provision one; its run-scoped records were cleaned. Its [101-connector read sample](evidence/m11-04-ci-hub-read-load.json) measured p95 199.5 ms and p99 215.3 ms for 50 reads at concurrency ten. These screens had no live provider credentials, so provider binding creation was verified by contract, SQL, and simulator tests rather than a customer account.

No GitHub, GitLab, or Azure sandbox was connected for this run. A provider-specific sandbox should verify installation/project/pipeline permissions, secret rotation, webhook delivery, reruns, and rate limiting before claiming live compatibility. Azure API checks confirm the configured service connection is restricted to the bound pipeline, but API responses cannot prove that the supplied bearer originated from that connection or that the build consumed it. The gate remains nonpassing until a named policy owner supplies approved criteria.
