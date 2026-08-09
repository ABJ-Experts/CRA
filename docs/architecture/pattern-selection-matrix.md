# Design Pattern Selection Matrix

This catalogue covers all 22 GoF patterns discussed in Alexander Shvets,
_Dive Into Design Patterns_ (2019). It is a decision aid for CRA, not a mandate
to place every pattern in every feature. Choose a pattern only when its trigger
exists now and a direct implementation no longer satisfies the requirement.

## Creational patterns

### Factory Method

- Decision: keep narrowly at construction boundaries.
- CRA anchor: fresh anonymous/user-scoped Supabase clients and provider
  construction that varies by privilege or environment.
- Trigger: one product contract has multiple concrete construction paths.
- Avoid: a literal or direct constructor is clearer; subclasses would exist
  only to rename `new`.
- Failure modes and tests: never cache a request/user client; run the same
  contract suite against each product and prove lifecycle isolation.
- Related patterns: use Abstract Factory only when several related products
  vary together; use Strategy when behavior, rather than construction, varies.

### Abstract Factory

- Decision: deferred by default.
- CRA anchor: a future coherent real/mock provider family spanning identity,
  notification, and audit products.
- Trigger: at least two related product types must switch as one family.
- Avoid: only one product varies or every factory would contain unused methods.
- Failure modes and tests: product-family mismatch and costly product additions;
  run one conformance suite against every complete family.
- Related patterns: factories may use Factory Methods, Prototypes, or return
  Builders.

### Builder

- Decision: prefer immutable factory functions until ordered construction is
  real.
- CRA anchor: complex export/query/email assembly with validated required steps.
- Trigger: ordered required steps or many interdependent optional parts cannot
  be represented safely by a Zod-validated object.
- Avoid: shallow DTOs, response envelopes, or query objects are clear literals.
- Failure modes and tests: shared mutable builder state across requests,
  incomplete products, and order dependence; test every required-step failure
  and return an immutable product.
- Related patterns: a Builder may construct Composite trees or be supplied by
  an Abstract Factory.

### Prototype

- Decision: prefer explicit defensive-copy helpers.
- CRA anchor: future saved table or permission presets with a documented deep
  copy boundary.
- Trigger: expensive configured objects must be cloned independently of their
  concrete implementation.
- Avoid: object spread or `structuredClone` already expresses the operation.
- Failure modes and tests: nested reference sharing, class serialization, and
  copying secrets; mutate a clone in tests and prove the source is unchanged.
- Related patterns: Prototypes can populate an Abstract Factory without adding
  creator subclasses.

### Singleton

- Decision: container-owned, stateless/process-wide resources only.
- CRA anchor: Nest singleton providers, the service-role client, JWKS cache, and
  exact permission cache.
- Trigger: one process resource has a proven shared lifecycle and contains no
  request identity.
- Avoid: tenant, user, request, session, mutable test, or hot-reload state.
- Failure modes and tests: cross-request data leakage and test contamination;
  test concurrent users and reset or replace any mutable cache through DI.
- Related patterns: a Factory Method may return a container-managed singleton,
  but callers must still depend on its contract.

## Structural patterns

### Adapter

- Decision: default at external boundaries.
- CRA anchor: Supabase/PostgREST repositories, GoTrue identity, SMTP
  notification, JWT/JWKS, and web HTTP/MSW transports.
- Trigger: provider input, output, lifecycle, or errors differ from the inward
  port.
- Avoid: both sides are owned and can use one shared contract directly.
- Failure modes and tests: lossy mapping, provider errors leaking outward, and
  provider-specific null semantics; use translation goldens and port contract
  tests.
- Related patterns: Adapter reconciles existing interfaces; Bridge separates
  two dimensions designed to vary independently.

### Bridge

- Decision: approved only when both axes have real variants.
- CRA anchor: a future independently varying application abstraction and
  storage/channel implementation.
- Trigger: at least two abstractions and two implementors must vary without a
  Cartesian subclass hierarchy.
- Avoid: one axis or one concrete implementation exists.
- Failure modes and tests: abstraction maze and invalid combinations; run
  abstraction tests against every supported implementor pairing.
- Related patterns: resembles Adapter, State, and Strategy structurally, but its
  purpose is independent evolution across two axes.

### Composite

- Decision: keep for genuinely recursive models.
- CRA anchor: the navigation/menu tree.
- Trigger: leaves and containers need the same operation.
- Avoid: the domain is flat or fixed-depth.
- Failure modes and tests: cycles, unbounded depth, unstable order, and
  leaf/container invariant drift; test cycle rejection, depth bounds, empty
  groups, and mixed traversal.
- Related patterns: Builder can assemble it, Iterator traverses it, Visitor adds
  operations, and Decorator may share its recursive interface.

### Decorator

- Decision: use framework metadata or explicit wrappers with tested order.
- CRA anchor: Nest route metadata, interceptors, and focused telemetry/cache
  wrappers.
- Trigger: orthogonal behavior must compose without subclass multiplication.
- Avoid: authorization becomes hidden, wrapper order changes untested behavior,
  or a direct call is clearer.
- Failure modes and tests: double wrapping, swallowed exceptions, and order
  sensitivity; verify every supported composition and short-circuit.
- Related patterns: Decorator adds behavior, while Proxy controls access or
  lifecycle and Composite models part/whole trees.

### Facade

- Decision: default feature entry point.
- CRA anchor: existing Nest services as compatibility facades and typed web
  feature clients.
- Trigger: callers would otherwise coordinate multiple use cases or provider
  objects.
- Avoid: the facade merely republishes every subsystem method or accumulates
  unrelated domains.
- Failure modes and tests: god service, hidden transactions, and leaky provider
  errors; test public scenarios at the facade and keep internal units focused.
- Related patterns: a Facade may expose container-managed infrastructure, but
  must not become a service locator.

### Flyweight

- Decision: existing immutable module data only unless profiling proves need.
- CRA anchor: design tokens and permission/menu metadata.
- Trigger: measured memory cost comes from many identical immutable intrinsic
  values.
- Avoid: object count is small or any shared field is mutable.
- Failure modes and tests: tenant/user state accidentally shared as intrinsic
  state; freeze shared values and prove extrinsic context stays per use.
- Related patterns: a Factory commonly owns flyweight reuse.

### Proxy

- Decision: framework-owned guards or explicit subject-preserving proxies.
- CRA anchor: Nest guards and versioned permission caching.
- Trigger: access control, lazy initialization, remote indirection, or exact
  caching must preserve the subject interface.
- Avoid: latency/security becomes invisible, callers can bypass it, or cache
  freshness is uncertain.
- Failure modes and tests: stale authorization, outage treated as denial of
  credentials, and bypass paths; test invalidation, outages, and interface
  substitutability.
- Related patterns: Proxy controls access/lifecycle; Decorator composes added
  behavior; Adapter changes the interface.

## Behavioral patterns

### Chain of Responsibility

- Decision: keep explicit, ordered, and short-circuiting.
- CRA anchor: throttle, authentication, MFA/session checks, authorization,
  controller validation, then exception mapping.
- Trigger: independent handlers may reject or pass a request in a defined order.
- Avoid: a direct fixed function reads more clearly.
- Failure modes and tests: reordered guards, accidental fallthrough, duplicate
  handling, and no terminal handler; test order and every break condition.
- Related patterns: handlers can traverse a Composite and may carry Commands,
  but the request chain itself remains visible.

### Command

- Decision: plain immutable command records for qualifying mutations.
- CRA anchor: invitation acceptance, role mutation, session revocation, and
  future outbox work.
- Trigger: audit identity, idempotency, retry, queuing, or undo is required.
- Avoid: one direct method call is enough; no global command bus without
  multiple actual consumers.
- Failure modes and tests: payload-version drift, unsafe replay, duplicate
  effects, and hidden authorization; test idempotency and receiver outcomes.
- Related patterns: Memento may support undo, Strategy may choose execution,
  and a Visitor can resemble commands across element types.

### Iterator

- Decision: native iteration first, async iteration for real streams.
- CRA anchor: arrays and menu traversal; future paged exports.
- Trigger: representation or pagination state must be hidden from callers.
- Avoid: array iteration is sufficient.
- Failure modes and tests: unstable ordering, endless pagination, duplicate or
  skipped items, cancellation, and concurrent changes; cover empty/single/page
  boundaries and abort behavior.
- Related patterns: commonly traverses Composite structures and can feed a
  Visitor.

### Mediator

- Decision: feature-local coordinator only.
- CRA anchor: a feature hook/page controller coordinating three or more peers.
- Trigger: peers have demonstrated many-to-many communication.
- Avoid: it becomes global application state or a god object.
- Failure modes and tests: hidden event order and centralized complexity; test
  scenarios at the mediator boundary and peer isolation.
- Related patterns: it may coordinate Observer notifications, while a Facade
  simplifies use by external callers.

### Memento

- Decision: deferred until a concrete undo/draft requirement.
- CRA anchor: future editor history or permission-matrix drafts.
- Trigger: users must restore bounded, versioned state without exposing object
  internals.
- Avoid: no restore requirement exists.
- Failure modes and tests: bearer secrets in snapshots, unbounded storage,
  incompatible versions, and cross-user restore; test size, retention,
  ownership, version migration, and redaction.
- Related patterns: commonly paired with Command for undo.

### Observer

- Decision: libraries/DB triggers today; durable events for future side effects.
- CRA anchor: React Query observers and permission-version triggers.
- Trigger: multiple independent, non-authoritative consumers need an update.
- Avoid: authorization, revocation, password reset, account deactivation, audit
  facts, or MFA correctness depends on eventual in-process delivery.
- Failure modes and tests: lost/duplicate/out-of-order events, listener leaks,
  and retry storms; require dedupe, retry/backoff, poison handling, and metrics
  before using an outbox.
- Related patterns: a Mediator may coordinate observers; an outbox supplies
  durability but is an architectural pattern beyond the GoF mechanism.

### State

- Decision: adopt for persisted lifecycles.
- CRA anchor: invitation and authentication/MFA transitions.
- Trigger: behavior and allowed actions vary across at least three meaningful
  states or concurrency makes transitions error-prone.
- Avoid: a boolean or small stable union is sufficient.
- Failure modes and tests: illegal transitions, stale concurrent writes,
  missing terminal states, and time-dependent ambiguity; centralize a legal
  transition table and test every state/event pair.
- Related patterns: State resembles Strategy, but selection follows the
  object's lifecycle rather than caller policy.

### Strategy

- Decision: default when multiple real algorithms exist.
- CRA anchor: HS256/JWKS verification and permission-policy variation.
- Trigger: two or more algorithms share a stable contract and selection is
  explicit or policy-driven.
- Avoid: only one algorithm exists or selection is more complex than the work.
- Failure modes and tests: unsafe fallback, unsupported algorithm confusion,
  and divergent error semantics; contract-test every strategy and reject
  unknown selectors.
- Related patterns: competes with Template Method and resembles State/Bridge in
  shape, but varies algorithms.

### Template Method

- Decision: prefer a functional pipeline; no new base class by default.
- CRA anchor: the guard/request workflow is a composition pipeline, not an
  inheritance hierarchy.
- Trigger: several implementations genuinely share a stable workflow skeleton
  while varying named steps.
- Avoid: composition or Strategy is clearer, or hooks would be optional forests.
- Failure modes and tests: fragile base classes and invisible hook order; test
  the skeleton once plus every concrete variation.
- Related patterns: Factory Method can be a customization hook; Strategy is the
  preferred composition alternative in TypeScript.

### Visitor

- Decision: deferred by default.
- CRA anchor: a future stable menu/permission element hierarchy with several
  unrelated export or analysis operations.
- Trigger: element types are stable while operations change frequently.
- Avoid: element types still evolve or ordinary mapping is clear.
- Failure modes and tests: double-dispatch ceremony, exhaustive update drift,
  and cyclic traversal; test every visitor/element pairing and traversal bound.
- Related patterns: commonly operates on a Composite through an Iterator and
  can be understood as commands distributed across receiver types.

## Selection gate

Every feature design answers:

1. What concrete variation, lifecycle, tree, workflow, or external boundary
   exists?
2. What is the simplest direct implementation?
3. Which pattern removes a demonstrated coupling or risk?
4. Why are nearby patterns not a better fit?
5. What new failure modes does the pattern introduce?
6. What contract test proves every implementation is substitutable?
7. How can the change be rolled back without data loss or wire-contract drift?

A feature is rejected when its only rationale is “use all patterns,”
“future-proofing,” or resemblance to a book class diagram.
