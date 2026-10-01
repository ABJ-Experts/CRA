# M12-01 source-linked task inbox design

## Scope and preserved contracts

The inbox brings authorized M5 finding triage and assessment approvals, M6 report draft approvals, M8 evidence expiry, and M9 supplier evidence requests into one view. A task is identified by `(organization_id, task_type, source_id)`. Source records own title, due date, lifecycle, and completion. The inbox owns only routing, workflow groups, claims, delegation, and absence intervals. Opening a task navigates to the source workflow; there is no generic completion action. M12-03 delivery, source approval rules, and IAM role grants stay with their current owners.

Existing `/api/v1`, ES256/JWKS sessions, narrow refresh cookie, source routes, auth actions, permission merge order, menu behavior, and mock passthrough are preserved. M5 individual reassignment updates the existing source assignee; other routing is inbox metadata.

## Concrete problem and simpler option

The five source modules expose separate queues and owner fields, and there is no group, delegation, or out-of-office model. A browser-only merged list cannot atomically claim a group item, audit a reassign, or keep organization-wide absence rules. A shared task-status table would duplicate source state and become stale. The smallest durable addition is scoped routing metadata plus live source projection and source-authorized commands.

## Selected and rejected patterns

- A source-specific projection adapter is warranted by five existing source schemas and permission rules. The application boundary consumes one validated task row shape; adapters may be removed if the source models converge. Direct cross-feature imports into the controller would couple presentation to storage and omit tenant checks.
- A database compare-and-swap command with an idempotent audit ledger is warranted by concurrent group claims, reassignment retries, and the need to commit routing and its audit fact together. It is not a generic command bus or event platform.
- Existing feature-local web gateway and transport parse shared Zod contracts. A new client framework, task event worker, and workflow designer add no present capability and are rejected.

Dependency direction remains React page → tasks gateway/transport → `@repo/contracts/tasks` → thin Nest controller → task application policy → organization-scoped Supabase adapter/RPC. Source actions continue through their own existing use cases.

## Data, tenant, and concurrency boundaries

Verified session identity supplies organization and user. Every service-role read and command takes organization first, checks active organization membership, source-specific permission, active product, and route/source identity before showing title, count, or choice. Group membership is task routing only and never grants source access. A route for a missing source may appear with a title-free unavailable state only when the viewer still has the relevant source permission. Revocation removes the row and its count on the next read.

The route is versioned. A claim changes an unclaimed group route with a conditional update; one contender wins and another receives a conflict. Reassignment, delegation, revoke, and release require expected route and source revisions plus an idempotency key. The transaction records routing outcome and audit together. A source owner change invalidates stale routing. Delegation is one hop, preserves the accountable owner, and checks substitute active membership and source eligibility at write and read time. UTC out-of-office ranges are half-open, non-overlapping per owner, and cannot create chains or cycles. Ineligible or expired substitutes yield an unresolved assignment and a safe fallback.

Migrations are additive, use non-forced RLS, explicit RPC grants, pinned function search paths, and CLI-generated types. Deploy schema and types before API and web. No source backfill is needed because current source rows are projected live. Previous application code can run with the extra routing and audit tables retained.

## API and rendering boundaries

`@repo/contracts/tasks/schemas` owns path, query, body, success, and error schemas; `types` derives trusted `z.output` shapes. `GET /api/v1/tasks` supports scope, type, source state, owner, due range, a filter-bound opaque cursor, and a 1–100 page limit. Success rows contain source link and opaque source revision. The browser supplies `inputSchema` for mutation bodies and `schema` for all success payloads. Nest parses every consumed path/query/body and declares parsed successful JSON responses.

The functional `/tasks` page uses the existing gateway. My, Group, and Available views show compact source-linked rows and source-specific action links, not a generic done control. Assignment and absence forms preserve drafts on conflict/offline errors. Text labels accompany overdue, delegated, unresolved, and unavailable states. Existing source pages validate deep-link IDs before selecting source records. Keyboard focus, locale dates, reduced motion, and semantic tokens follow the current workspace design.

## Failure modes and tests

Source deletion/archive/reopen and delayed updates are resolved from current source data on each read. Permission or product access loss fails closed. A stale route/source version returns conflict; an identical idempotency retry returns its recorded result. A changed payload under the same key conflicts. Database outage is an error, never an empty authorized list. No inbox command approves an M5 assessment, M6 report, or M9 submission.

Tests start with failing schema/source eligibility and authorization cases. Focused unit tests cover source mapping, pagination, delegation expiry/cycles, and UI states; transaction-rolled-back local SQL tests cover RLS/grants, tenant substitution, idempotency, concurrent claim, group removal, and atomic audit. Local API/browser tests cover source links, organization switch, permission revocation, retries, and accessibility. Run coverage for new/materially changed modules, DB lint, `pnpm verify`, relevant live-stack regressions, and a bounded paginated read load check. Logs carry safe task identity and error code without source content or credentials.

## Rollback and review

Rollback runs the prior API/web while leaving additive routing and audit evidence in place. A later forward migration may retire unused metadata after review; it does not delete source or user data. Review must confirm source-specific ACL, current product scope, no generic done path, atomic routing/audit, idempotency, ≤100 pagination, parsed wire boundaries, and no regressions to source actions or session behavior.
