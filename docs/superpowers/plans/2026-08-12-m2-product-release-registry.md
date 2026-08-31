# M2 product and release registry implementation plan

1. Add product/release Zod contracts and immutable legal-entity provenance.
2. Add additive tenant-safe registry tables, indexed RPCs, RLS/grants, atomic audit/onboarding integration, and SQL checks.
3. Add a thin Nest product module using the existing authorization/error/response boundary pattern.
4. Add typed dashboard list/detail/release UI using `/api/v1/products`, leaving dashboard mocks unchanged.
5. Regenerate database types and verify focused contract, API, browser, E2E, database, type, lint, and build gates.
