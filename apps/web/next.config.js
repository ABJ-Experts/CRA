/**
 * The API lives on :3333, the web app on :3000.
 *
 * A rewrite PROXY rather than cross-origin fetch, so the browser only ever
 * talks to its own origin. That gives first-party cookies with no CORS on the
 * browser path at all, and removes the class of failure where the browser
 * reports a bare CORS error with no status — which the reference mitigated in
 * three separate places before giving up and proxying.
 *
 * THE `/api/v1` PREFIX IS LOAD-BEARING, not decoration. `mocks/handlers.ts`
 * already owns `/api/products`, `/api/orders`, `/api/customers` and
 * `/api/coins`. A rewrite at `/api/:path*` would put the real API and the
 * mocked dashboard data in one namespace, and the collision would be
 * intermittent and environment-dependent: browser service worker, `msw/node`
 * inside `instrumentation.ts`, and a production build all resolve it
 * differently. `/api/v1` cannot match any existing handler.
 */

/*
 * This file runs in Node, but the shared Next ESLint config only declares
 * browser and serviceworker globals. Declared here rather than by widening the
 * shared config, which would relax the rule for every browser file too.
 */
/* global process */
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3333";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
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
    ];
  },
  async rewrites() {
    return {
      // `beforeFiles` so the proxy wins before Next looks for a route handler
      // or a static file at the same path.
      beforeFiles: [
        {
          source: "/api/v1/:path*",
          destination: `${API_ORIGIN}/api/v1/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
