const { join } = require("node:path");

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-packages-to-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: {
        path: ["^apps/", "^@repo/(api|docs|infrastructure|web)(?:/|$)"],
      },
    },
    {
      name: "no-web-to-api-or-infrastructure",
      severity: "error",
      from: { path: "^apps/web/" },
      to: {
        path: [
          "^apps/(api|infrastructure)/",
          "^@repo/(api|infrastructure)(?:/|$)",
        ],
      },
    },
    {
      name: "no-api-to-web",
      severity: "error",
      from: { path: "^apps/api/" },
      to: { path: ["^apps/web/", "^@repo/web(?:/|$)"] },
    },
    {
      name: "domain-does-not-depend-outward",
      severity: "error",
      from: { path: "^apps/api/src/[^/]+/domain/" },
      to: {
        path: "/(application|infrastructure|presentation)/|\\.(controller|module)\\.ts$",
      },
    },
    {
      name: "application-does-not-depend-on-adapters",
      severity: "error",
      from: { path: "^apps/api/src/[^/]+/application/" },
      to: { path: "/infrastructure/|\\.(controller|module)\\.ts$" },
    },
    {
      name: "core-does-not-import-provider-frameworks",
      severity: "error",
      from: { path: "^apps/api/src/[^/]+/(domain|application)/" },
      to: {
        path: "^(?:@nestjs/|@supabase/|express$|jose$|nodemailer$)",
      },
    },
    {
      name: "shared-ui-does-not-own-app-state",
      severity: "error",
      from: { path: "^packages/ui/" },
      to: {
        path: "^(apps/|@repo/(api|docs|infrastructure|web)(?:/|$)|@tanstack/react-query)",
      },
    },
    {
      name: "no-unresolved-workspace-imports",
      severity: "error",
      from: { path: "^(apps|packages)/" },
      to: { path: "^@repo/", couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude:
      "(^|/)(dist|build|coverage|\\.docusaurus|\\.next|\\.turbo|node_modules)/",
    tsConfig: { fileName: join(__dirname, "tsconfig.architecture.json") },
    tsPreCompilationDeps: true,
  },
};
