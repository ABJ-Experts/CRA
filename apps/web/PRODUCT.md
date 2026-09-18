# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

CRA Sentinel serves manufacturers that sell connected products in the European Union. Its primary day-to-day user is the Product Security Manager, who owns vulnerability-triage outcomes and regulatory reporting decisions. Security engineers and PSIRT responders investigate findings, draft reports, and record remediation; quality or regulatory managers manage technical-file completeness and declarations of conformity; release and DevOps engineers automate SBOM ingestion; system administrators manage identity, integrations, deployment, and retention; organization owners govern approvals and access. Executives and viewers read dashboards without editing. Scoped external users include auditors or notified bodies and suppliers responding through a restricted portal. ABJ support and platform administrators operate under audited, time-boxed access.

## Product Purpose

CRA Sentinel is the system of record for product security and EU Cyber Resilience Act (Regulation (EU) 2024/2847) compliance operations. It helps a manufacturer answer, on demand, what software is inside its products, which known vulnerabilities materially affect them, what action was taken, and what evidence can be shown to a regulator. Success means timely, defensible, human-approved compliance decisions backed by durable evidence.

## Positioning

The product combines a product and asset registry, SBOM intelligence, vulnerability matching and triage, regulatory obligation timers, technical-file evidence, and verifiable audit history for regulated connected products. Its distinguishing constraints are clock correctness for statutory deadlines, immutable provenance suitable for regulatory scrutiny, and the same product operating as EU-hosted multi-tenant SaaS, isolated private deployment, or fully air-gapped installation.

## Operating Context

Manufacturers use the platform within product-security and regulatory workflows: importing CycloneDX or SPDX SBOMs from CI/CD, maintaining products, variants, releases, classifications, support periods, and EU market availability; matching components against vulnerability intelligence; triaging findings and creating VEX statements; drafting and approving staged regulatory reports; compiling Annex VII technical files and declarations of conformity; managing supplier evidence and framework mappings; and tracking work in a unified task inbox. Regulatory reporting involves 24-hour, 72-hour, 14-day, and one-month clocks, whose constants must be effective-dated configuration rather than code literals. AI features are advisory; people remain accountable for decisions and no regulatory submission may occur without human approval.

## Capabilities and Constraints

- In scope: product and asset registry; SBOM ingestion, validation, normalization, diffing, and export; vulnerability intelligence and continuous re-evaluation; triage, approvals, and VEX generation; regulatory reporting; technical files; evidence and supplier attestations; framework mapping; workflow, notifications, integrations, auditing, licensing, deployment tooling, and AI assistance.
- The product is product-centric rather than a general-purpose GRC suite. It records security-testing outcomes but does not perform offensive security tooling, source static analysis, binary decompilation, firmware reverse engineering, or OT/ICS monitoring.
- Native mobile applications and unattended regulatory submission are excluded. Responsive web supports reading and approval.
- The customer may need SaaS, dedicated private-cloud, on-premises, air-gapped, or hybrid deployment. Core functionality must operate with egress blocked when current offline feed bundles and a local model are available.
- Tenant isolation, authorization, evidence retention, legal holds, provenance, auditability, and configuration validation are product boundaries. User-facing localization and WCAG 2.2 AA are required.
- Regulatory rules in the BRD are build inputs, not legal advice; qualified EU regulatory review is required before customers file real reports.

## Brand Commitments

The product name is CRA Sentinel. The governing BRD identifies it as a "Product Security and EU Cyber Resilience Act Compliance Operations Platform." No external customer proof, pricing, or sales claims are available in the supplied sources and must not be invented.

## Evidence on Hand

- Business requirements: `/Users/abjmac003/Downloads/CRA-Sentinel-Technical-BRD-v2.0-ABJ-Experts.pdf` (v2.0, 25 July 2026), prepared by ABJ Experts for engineering, architecture, QA, and design.
- Implemented web application: `apps/web`, with shared UI and token packages under `packages/ui` and `packages/design-system`.
- Existing architecture documentation under `docs/architecture/`, including organization onboarding, tenant administration, product registry, release-market lifecycle, and product-relationship workflows.
- Available visual assets are limited to product/auth SVGs and the incumbent UI. No validated testimonials, customer logos, pricing, or independent market claims are available.

## Product Principles

1. Treat statutory clocks, data integrity, and evidence retention as correctness requirements.
2. Keep people accountable: AI can assist, but it cannot make or submit regulatory decisions.
3. Preserve tenant isolation, least privilege, and auditable provenance at every boundary.
4. Make the product useful in the customer's security perimeter, including disconnected environments.
5. Favor product-specific compliance workflows over broad, generic governance features.

## Accessibility & Inclusion

Meet WCAG 2.2 AA on every screen, with automated accessibility testing in CI and periodic manual keyboard-only review. Support current and previous major versions of Chrome, Edge, Firefox, and Safari. Localize all user-facing strings, dates, numbers, and durations.
