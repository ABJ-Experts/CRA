# ADR-0001: Select Patterns by Demonstrated Need

- Status: Accepted
- Date: 2026-08-09
- Owners: CRA maintainers

## Context

CRA already uses useful GoF ideas: provider factories, adapters/facades,
recursive menu composition, Nest decorators and guard proxies, an ordered
security chain, observers in React Query/database triggers, stateful auth
lifecycles, and algorithm strategies for token verification. Its scalability
risk is not missing pattern names. It is mixed responsibilities, weak mutation
workflow tests, implicit transaction boundaries, and rules that were described
but not mechanically checked.

Applying all 22 GoF patterns to every feature would add indirection, global
state, inheritance, and unused extension points. It would obscure the tenant
and security boundaries that must remain obvious.

## Decision

Patterns solve demonstrated problems; they are not a quota.

Every substantial feature completes
`docs/architecture/feature-design-template.md` and compares its direct design
with the 22-pattern catalogue in
`docs/architecture/pattern-selection-matrix.md`. A pattern is selected only
when its trigger exists in the current requirement. The design names concrete
participants, failure modes, contract tests, and rollback.

The default architecture is a feature-oriented modular monolith. Where layering
is justified, dependency direction is presentation to application to domain,
with infrastructure adapters implementing inward-owned ports. We favor
immutable functions and composition over inheritance.

## Consequences

- External providers use adapters behind application-owned ports.
- Features expose focused facades rather than leaking subsystem coordination.
- Strategies require multiple real algorithms; factories require real
  construction variation.
- State machines are introduced for persisted lifecycles with meaningful
  transition complexity.
- Abstract Factory, Memento, Template Method inheritance, Visitor, global event
  buses, global command buses, and hand-written stateful singletons require a
  separate ADR with a present-tense trigger.
- Deferred patterns remain explicitly considered, so book coverage is complete
  without architecture theatre.
- New abstractions carry tests and a removal trigger, making accidental
  complexity reversible.

## Alternatives considered

### Require all 22 patterns in every feature

Rejected. The patterns address different problem shapes and several are
alternatives to one another. A quota would reduce cohesion and make security
review harder.

### Ban patterns and use direct functions everywhere

Rejected. Provider boundaries, multiple algorithms, recursive models, and
persisted lifecycles benefit from explicit, tested patterns.

### Rewrite into microservices first

Rejected. Current module boundaries do not yet require independent deployment,
and distributed transactions would worsen the highest-risk workflows. The
modular monolith keeps future extraction possible through ports without adding
network failure modes today.

## Rollback

This decision adds documentation and verification only. It can be reverted
without data or wire-contract changes. Feature implementations made under it
remain independently revertible because compatibility facades and additive
migrations are required.
