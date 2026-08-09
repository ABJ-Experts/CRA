# Design Patterns in CRA

This document maps the pattern decisions to the current implementation. It is
an index, not a requirement to use every pattern in every feature. The complete
22-pattern decision, trigger, counterexample, failure-mode, and relationship
catalogue is the [pattern selection matrix](./pattern-selection-matrix.md).

## Implemented architecture anchors

| Pattern                 | Current anchor                                                | Contract that keeps it safe                                                  |
| ----------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Factory Method          | Fresh Supabase anonymous and user-scoped clients              | Concurrent identities never share a client session                           |
| Singleton               | Container-owned stateless services and bounded caches         | No request, user, tenant, token, or password state in a singleton            |
| Adapter                 | Supabase repositories, mail/JWT adapters, browser HTTP client | Provider payloads are validated and provider errors do not leak              |
| Composite               | Menu/navigation tree                                          | Stable traversal, key parity, and no authorization authority                 |
| Decorator               | Nest route metadata                                           | Public and protected route coverage fails in both directions                 |
| Facade                  | Nest compatibility services and browser feature APIs          | Existing routes, signatures, status codes, and response bodies stay stable   |
| Flyweight               | Immutable permission, menu, and design-token metadata         | Shared values are frozen and contain no tenant state                         |
| Proxy                   | Versioned permission resolver and Nest guards                 | Cache key includes organization, user, and base role; outages fail closed    |
| Chain of Responsibility | Throttle, authentication, then authorization                  | One composition root pins order and short-circuit behavior                   |
| Command                 | Immutable invitation, member, role, and auth mutation records | Commands carry explicit actor/scope and unsafe mutations are never replayed  |
| Mediator                | Feature-local React Query facades                             | No global event bus or hidden cross-feature state                            |
| Observer                | React Query observers and database version triggers           | Observers never decide authorization or security-critical completion         |
| State                   | Invitation and authentication lifecycle transitions           | Legal transitions and terminal/idempotent outcomes are exhaustive            |
| Strategy                | Explicit HS256 and JWKS token verification                    | Only HS256, ES256, and RS256 are selectable; algorithm confusion is rejected |
| Template Method         | Framework request lifecycle only                              | Application/domain code does not inherit framework templates                 |

Builder, Abstract Factory, Prototype, Bridge, Memento, Visitor, and custom
Iterator implementations remain deferred until their documented trigger exists.
Their absence is intentional: adding indirection without the matching problem
would reduce scalability by making ownership and failure behavior harder to
understand.

## Required feature decision

Before introducing a new abstraction, provider, state machine, cross-feature
dependency, or durable workflow, complete the
[feature design template](./feature-design-template.md). A selected pattern
must name its concrete participants, present-tense trigger, new failure modes,
tests, observability, and rollback. Nearby patterns must be rejected explicitly
when their structure looks similar but their intent does not fit.

## Compatibility facades

Existing controllers and public service methods remain compatibility facades
while callers migrate inward to use cases and ports. A facade may be removed
only in a separate release after repository search finds no caller, wire
contract tests remain unchanged, and the prior release completed without a
rollback signal.
