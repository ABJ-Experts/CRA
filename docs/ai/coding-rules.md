# Feature Implementation Rules

These rules apply to every developer and coding agent working in CRA. They turn
the architecture policy into a repeatable change workflow while preserving
existing behavior.

## Required sequence

1. Read `AGENTS.md`, the nearest feature code/tests, and every applicable
   invariant before planning a change.
2. Fill in `docs/architecture/feature-design-template.md` before creating an
   abstraction. Start with the direct solution and use
   `docs/architecture/pattern-selection-matrix.md` to compare alternatives.
3. Add characterization tests around every behavior being moved: public
   signatures, routes, status/body shapes, cookies, tenant scope, state
   transitions, and user-visible loading/error states.
4. Write the new failing test before production implementation. Add a port only
   when at least one adapter exists now; add a second strategy only when the
   second algorithm exists now.
5. Keep controllers and pages free of provider calls and domain decisions.
   Presentation invokes an application entry point; infrastructure implements
   an inward-owned port.
6. Define every cross-application request, query, parameter, success response,
   and error body in the owning feature under `@repo/contracts/<feature>/schemas`.
   Keep the corresponding trusted types under `<feature>/types`, derived with
   `z.output<typeof schema>`. Use `z.input` only before parsing; never hand-copy
   a wire shape into a controller, gateway, or component.
7. Parse every consumed Nest body, query, and path parameter before controller
   logic and declare `@ZodResponse` for every JSON route (or an explicit
   `@NonJsonResponse` kind). Browser callers parse outgoing bodies with
   `inputSchema` and incoming payloads with `schema` at the central transport.
8. Keep JSX in functional components. Use a plain `.ts` class for logic only
   when it owns injected dependencies, stateful coordination, an adapter, or a
   real lifecycle. Keep deterministic policies as immutable functions. A React
   class component is limited to an error boundary or documented third-party
   lifecycle requirement.
9. Inject failures for the database, JWKS, SMTP, network, duplicate request,
   stale state, concurrency, invalid transition, and authorization paths that
   are relevant to the feature. Prove partial work cannot broaden access or
   leave an impossible persisted state.
10. Run focused tests and coverage for touched modules. Run live tests whenever
    cookies, database functions/triggers, RLS, transactions, session state, or
    mail changes. Then run the full repository verification gate.
11. Review the diff for secret leakage, explicit tenant filters, error semantics,
    backward compatibility, observability, and rollback before committing.

## Pattern acceptance checks

A selected pattern must record:

- the concrete present-tense trigger;
- its participants and dependency direction in this feature;
- the direct implementation that was rejected and why;
- nearby patterns considered;
- new failure modes and the tests that cover them;
- a contract test shared by every implementation;
- a removal trigger and safe rollback.

“Use all patterns,” “future-proofing,” and resemblance to a class diagram are
not valid reasons. Prefer immutable functions, discriminated unions, and direct
composition until current requirements demonstrate a need for more structure.

## Security and consistency review

- Browser state controls routing/presentation only. Authentication and
  authorization remain server-authoritative.
- Service-role access is self-scoped from verified identity or accepts `orgId`
  first and applies it to every tenant query.
- Security-critical mutations and their audit facts are synchronous or share a
  durable database transaction. In-process observers are non-authoritative.
- Retried/replayed mutations require idempotency. Never automatically retry a
  POST/PATCH after refresh without an idempotency contract.
- Provider outages are distinct from invalid user input. Do not turn an outage
  into a sign-out, permission grant, or irreversible partial update.
- Secrets, access/refresh tokens, OTPs, recovery codes, and signing material are
  never logged, snapshotted, embedded in fixtures, or emitted through events.

## Completion gate

A feature is complete only when:

- tests were observed failing for the intended reason before implementation;
- new/materially refactored modules meet at least 80% branch, function, line,
  and statement coverage;
- focused unit/contract/integration tests pass;
- applicable DB lint, RLS, auth, cookie, trigger, mail, and browser E2E tests
  pass against the live local stack;
- lint, type-check, architecture verification, full tests, and production build
  pass from the repository root;
- an independent review has no unresolved critical or high findings;
- rollback and deploy ordering remain accurate.
