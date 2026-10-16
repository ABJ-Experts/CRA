# M12-04 in-app notification centre

## Scope and preserved contracts

- **Outcome:** an authenticated member sees their own source-linked M2, M5, M6, M8, and M9 notifications, a permission-filtered unread count, and safe delivery-failure notices.
- **In scope:** category/severity/read filters, bounded pagination, per-recipient read state, validated destinations, 180-day feed visibility, and failure states in the workspace UI.
- **Out of scope:** task-transition messages, browser push, email-delivery replacement, regulatory acknowledgement, historical backfill, and ordinary access to admin delivery logs.
- **Preserved:** `/api/v1`, cookies/JWKS/session revocation, permission merge order, source outboxes and email-mode cutover, frozen auth actions, menu/mock contracts, and source/audit retention.

## Concrete problem and direct solution

M12-03 retains source-owned outboxes and provides email preferences and an audit-only delivery list. Those delivery records are not a per-user feed: optional dispatches are absent for legacy-mode organizations, and the list has neither ordinary-user authorization nor read state. M12-01 supplies safe source-link and current-access patterns, but its task projection excludes completed tasks. A notification cannot disappear merely because a task was completed.

The direct design reads the existing durable source rows through bounded, source-specific SQL branches and stores only per-user read state. This adds one read-state table and an activation timestamp on `organization_settings`. It avoids a second event bus, projector, or delivery worker. Source events that become effective after activation are visible even if they were scheduled earlier; older effective events are not backfilled. Read queries enforce the 180-day window, and the existing retention path removes expired read-state rows without changing legal source/audit evidence.

## Selected and rejected patterns

- **Existing notification facade and repository adapter:** the controller parses and delegates, the application port owns the feed operations, and the Supabase adapter calls organization-scoped RPCs. This is warranted by the already implemented Nest/Supabase boundary; the same contract tests cover each operation. Remove the feed methods if the centre is retired.
- **Immutable read model:** source-specific SQL branches produce one common, validated feed row. The existing outbox event ID is the logical identity; a later source revision has a different event ID. A delivery-failure notice is a separate kind, with a changed failure fingerprint becoming unread again. Remove the read-state table if per-user read tracking is retired.
- **Existing transactional command pattern:** bounded mark-read supplies an idempotency key and expected fingerprint. A PostgreSQL transaction checks every selected item, updates read state, and records its audit fact or returns an all-or-none conflict. No command bus is added.

Rejected alternatives: exposing the audit-only delivery list would leak operations data and miss legacy-mode optional events; using task rows would drop completed sources; persisting a second feed projection would add synchronization and worker-restart failure modes without a demonstrated need.

## Data and tenant boundaries

The authenticated API session supplies actor and active organization. Service-role RPCs take organization ID first and check active membership, current permissions, product and source access on **list, count, destination, and mark-read**. Recipient eligibility follows the current source-specific routing policy. A source deletion or archive yields only a generic unavailable row when category access remains; permission revocation hides the row and count. Failure notices expose safe status only; provider errors, addresses, bodies, and admin retry metadata remain private.

The read-state key includes organization, user, source kind/ID, and event-versus-failure kind. Repeated reads of the same fingerprint are idempotent. Changed source/failure fingerprints require a fresh action. List cursors bind the user, organization, filters, first-page snapshot, and descending event-time/identity key to prevent cross-scope reuse. The 180-day window is based on effective event time, not read time or projection time.

The additive migration uses `public.users.id` FKs, non-forced RLS, explicit service-only grants, pinned function `search_path`, generated database types, and organization export/purge registration. No existing organization changes its email delivery mode.

## API boundary contracts

`@repo/contracts/notifications/{schemas,types}` owns parsed feed query, reference, mark-read body, and success-response contracts. The controller exposes self-scoped `GET /feed`, `GET /feed/unread-count`, `GET /feed/:ref/destination`, and `POST /feed/mark-read` below `/api/v1/notifications`. Every consumed input uses a Zod pipe; every successful response uses `@ZodResponse`. The browser gateway passes `inputSchema` for the mutation and `schema` for each response. Trusted types derive from `z.output`.

Code links: [Zod schemas](../../packages/contracts/src/notifications/schemas/notification.schema.ts), [Nest controller](../../apps/api/src/notifications/notifications.controller.ts), [application port](../../apps/api/src/notifications/application/notification.port.ts), [Supabase adapter](../../apps/api/src/notifications/infrastructure/supabase-notification.repository.ts), and [browser gateway](../../apps/web/app/_features/notifications/notifications.api.ts).

List pages default to 25 and cap at 50; bulk mark-read caps at 50 unique explicit references. The destination endpoint constructs only canonical local application routes after current-access checks. Unknown or unauthorized references return 404; a changed fingerprint returns 409. Existing preference, critical-route, delivery-list, and retry contracts stay compatible.

## Frontend logic and rendering

The existing top-navigation bell opens a functional `/notifications` workspace page. The page uses semantic tokens, `cn()`, shared UI subpaths, compact rows, category/severity/read filters, a preferences link, and non-colour unread text. It provides loading, empty, offline, forbidden, conflict, retry, and source-unavailable states with visible keyboard focus and screen-reader updates. It resolves a destination immediately before navigation and does not follow stored or provider-supplied URLs.

`middleware.ts` protects `/notifications` with the existing access-token/refresh rules. Its route test includes a query-bearing notification URL and verifies a same-origin sign-in return URL.

The existing typed notification gateway owns HTTP transport. Feed query keys include verified organization and user; an organization switch or sign-out clears prior feed data and suppresses stale responses. Notification refresh failure leaves core triage, evidence, and reporting usable. No new sidebar/menu item or client-side authorization source is introduced.

## Failure modes, verification, and rollback

- **Source or permission changes:** each read/action rechecks access; inaccessible content disappears. Archived sources are generic and unlinked. If the source and its outbox are hard-deleted, the feed entry disappears and a cached destination resolves as unavailable.
- **Concurrent tabs and duplicate commands:** idempotent same-fingerprint reads succeed; a newer failure/source fingerprint returns conflict and remains unread until refreshed.
- **New events during pagination:** snapshot-bound keyset pagination prevents repeat rows; current authorization can remove a row between pages.
- **Database/network outage:** the centre shows retry without blocking other work or automatically replaying the mutation after auth refresh.
- **Large history:** source-specific indexes and 180-day predicates bound the query; measure both list and count against p95 400 ms/p99 1000 ms targets.

Start with failing contract, SQL, API, and browser tests. Include tenant substitution, inactive/revoked membership, product permission changes, forged references, missing sources, duplicates/revisions, failure recovery, concurrent mark-read, retention, and pagination during inserts. Require at least 80% branch/function/line/statement coverage for new or materially changed modules. Run focused tests, database lint/diff, `pnpm verify`, `pnpm test:live`, and auth/organization-switch/navigation/M1–M10 regressions. Use the local owner in a uniquely identified test organization for Playwright MCP and Supabase checks, preserving all unrelated data.

Deploy schema and generated types before API/web. Roll back code while retaining the additive table and user read state; correct schema later with a forward migration. Validate the full chain in a fresh staging database because this local Supabase ledger lacks older migration entries. The feed does not alter email delivery, source workflow decisions, or legal evidence.

## BRD traceability and release evidence

| Requirement | Implementation | Verification |
| --- | --- | --- |
| FR-WF-006 feed, filters, unread state and safe links | `notificationFeed*Schema`, feed RPCs, `NotificationCentre` and top-navigation bell | `notification.schema.spec.ts`, `m12-04-notification-feed.test.sql`, `notification-centre.spec.tsx`, `m12-04-notifications.spec.ts` |
| FR-WF-009 visible in-app delivery failures | M2/M5/M6/M8/M9 source-backed failure notices, including unified optional dispatch outcomes | `m12-04-notification-feed.test.sql` failure, recovery and changed-fingerprint assertions |
| Current access and tenant isolation | Active membership, source permission, recipient and organization checks in every feed RPC | `m12-04-notification-feed.test.sql`, notification controller/repository specs, organization-switch query tests |
| Bounded retention and export | 180-day visibility, tenant lifecycle cleanup, export mapping and exact purge cascade | `m12-04-notification-feed.test.sql`, tenant lifecycle worker specs, M1/M12-03 export SQL tests |

The additive migrations are `20261002083728_m12_04_notification_feed.sql`, `20261002085029_m12_04_feed_read_user_fk_index.sql`, `20261002085443_m12_04_late_failure_visibility.sql`, `20261002085803_m12_04_feed_m5_bounded_context.sql`, and `20261002090300_m12_04_unified_failure_notices.sql`. Each was applied locally before later corrections; applied files were retained unchanged. The local Supabase project is `cra` at `http://127.0.0.1:54321`; no organization was switched to unified email delivery. The new table has RLS enabled without browser policies by design, and only `service_role` has table access. The five feed migration versions are present in the local ledger.

`pnpm verify` passed after the final migration: 25 focused SQL assertions, 3,903 API tests, 1,267 web tests, 599 contract tests, and the production build. `pnpm --filter infrastructure run db:lint` passed with pre-existing warnings outside M12-04 functions. `supabase db diff --local --schema public` completed but reported broad pre-existing local/shadow drift; the full migration chain still needs validation in a fresh staging database. The initial 1,000-event M5 fixture improved from 1,478/1,489 ms to 28/21 ms for list/count after per-finding context batching. In a 30-call post-migration, warm, sequential sample with 1,000 rolled-back M5 events, list p95/p99 was 31.85/247.67 ms and unread count was 30.02/30.19 ms. Both meet the 400/1,000 ms read targets in this single-tenant local fixture; concurrent production load remains unmeasured. A maximum 50-item mark-read batch measured 1,115 ms and is a bounded mutation latency ceiling.

`pnpm test:live` passed: all infrastructure SQL checks, 10 API E2E assertions, and 33 auth-flow checks. The scoped Chromium browser journey passed with a newly created M12-04 organization, a real M6 deadline event, persisted per-user read state, verified destination, and simulated unavailable, forbidden, and offline feed states. The test restored the owner's original organization and deleted only its generated organization. A Supabase MCP post-test check found zero matching M12-04 test organizations, zero matching deadline rows, and zero feed-read rows; no organization had unified email delivery enabled. The auth-flow shell's two uniquely identified test users were then deleted by exact auth-user ID, and Supabase confirmed zero remaining public profiles for those addresses.

Focused coverage after the integration run: notification controller/use-case/repository modules achieved 100% statements and 96.22% branches; the two changed tenant lifecycle worker modules achieved 90.63% statements and 81.49% branches; the web centre/query/gateway modules achieved 98.05% statements and 90.44% branches. These targeted runs include their own direct tests and exceed the 80% combined threshold for the changed slices.

Playwright MCP screenshots of the signed-in empty state: `artifacts/m12-04/notifications-empty-desktop.png` and `artifacts/m12-04/notifications-empty-mobile.png`. The scoped browser journey saved `artifacts/m12-04/notifications-real-feed-desktop.png`, `artifacts/m12-04/notifications-states-desktop.png`, and `artifacts/m12-04/notifications-states-mobile.png`. A signed-out visit to `/notifications?read=unread` redirected to `/sign-in?returnUrl=%2Fnotifications%3Fread%3Dunread`; `artifacts/m12-04/notifications-auth-redirect-mobile.png` records that state. The browser accessibility snapshot confirmed link/button semantics; a mobile DOM check found one main heading, zero unlabeled feed filters or actions, one live/status region, and no horizontal overflow. An automated WCAG audit across browser engines remains unverified.

For rollback, deploy the previous API/web versions while retaining these additive migrations and user read state. Do not remove source outboxes or reset data. Run the existing tenant lifecycle worker to expire read-state rows; use a new forward migration for any later schema correction. Hard-deleted outbox records cannot retain a generic feed row without a separate projection, so cached links resolve unavailable instead. SMTP acceptance and inbox delivery remain separate M12-03 states.

Operational command: after building the API, `pnpm --filter api run worker:tenant-lifecycle` runs the existing tenant lifecycle process and now performs bounded notification read-state cleanup. The feed requires no new secret, relay, hosted provider, or delivery worker. Keep the local Supabase and API targets from the repository runbook; deploy these additive migrations and generated types before the API/web version.
