import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

type Redirect = Readonly<{
  source: string;
  destination: string;
  permanent: boolean;
}>;

const configWithRedirects = nextConfig as typeof nextConfig &
  Readonly<{
    redirects?: () => Promise<Redirect[]>;
  }>;

describe("legacy dashboard redirects", () => {
  it("permanently maps every migrated dashboard customer path to its canonical top-level path", async () => {
    const redirects = await configWithRedirects.redirects?.();

    expect(redirects).toEqual([
      {
        source: "/dashboard/management",
        destination: "/management",
        permanent: true,
      },
      {
        source: "/dashboard/organization",
        destination: "/organization",
        permanent: true,
      },
      {
        source: "/dashboard/products",
        destination: "/products",
        permanent: true,
      },
      {
        source: "/dashboard/products/:productId",
        destination: "/products/:productId",
        permanent: true,
      },
      {
        source: "/dashboard/account",
        destination: "/account",
        permanent: true,
      },
      {
        source: "/dashboard/security",
        destination: "/security",
        permanent: true,
      },
      {
        source: "/dashboard/roles",
        destination: "/roles",
        permanent: true,
      },
      {
        source: "/dashboard/permissions",
        destination: "/permissions",
        permanent: true,
      },
      {
        source: "/dashboard/onboarding",
        destination: "/onboarding",
        permanent: true,
      },
    ] satisfies Redirect[]);
  });
});
