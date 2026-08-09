# CRA documentation site

This Docusaurus application contains the project documentation.

Run from the repository root with Node 20+ and pnpm 10.33.4:

```sh
pnpm install
pnpm --filter docs run dev
pnpm --filter docs run build
pnpm --filter docs run check-types
```

The development server listens on port 3001. Repository-wide verification is
documented in the root `README.md`.
