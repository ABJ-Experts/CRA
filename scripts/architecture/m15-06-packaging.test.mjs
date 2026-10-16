import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
test("fixed inventory accounts for every executable worker and maintenance entry", () => {
  const inventory = JSON.parse(
    readFileSync("deployment/service-inventory.json", "utf8"),
  );
  for (const file of readdirSync("apps/api/src").filter((name) =>
    /(?:-worker|-vault-maintenance)\.ts$/.test(name),
  ))
    assert(
      inventory.services.some(
        (service) =>
          service.entry === `apps/api/dist/${file.replace(/\.ts$/, ".js")}`,
      ),
      file,
    );
  for (const id of [
    "api",
    "agent-ingress",
    "operator-api",
    "operator-web",
    "web",
    "agent",
  ])
    assert(
      inventory.services.some((service) => service.id === id),
      id,
    );
});
test("deployment has no mutable image, auto pull/build or customer Docker credentials", () => {
  const compose = readFileSync("deployment/compose.yml", "utf8");
  assert(!/^\s+build:/m.test(compose));
  const customer =
    compose.slice(0, compose.indexOf("  backup-worker:")) +
    compose.slice(compose.indexOf("  chat-vault-maintenance:"));
  assert(!customer.includes("docker.sock"));
  assert(compose.includes("profiles: [backup-control]"));
  assert(compose.includes("pull_policy: never"));
  assert(
    readFileSync("deployment/edge.mjs", "utf8").includes(
      "response.writeHead(503",
    ),
  );
});
test("every managed application worker entry uses the drain helper", () => {
  for (const file of readdirSync("apps/api/src").filter((name) =>
    /(?:-worker|-vault-maintenance)\.ts$/.test(name),
  )) {
    const source = readFileSync(`apps/api/src/${file}`, "utf8");
    assert(
      source.includes("maintenanceRun"),
      `${file} cannot acknowledge drain`,
    );
  }
  assert(
    readFileSync("apps/agent/src/main.ts", "utf8").includes(
      "agentMaintenanceClosed(process.env",
    ),
  );
  for (const name of ["main.ts", "agent-main.ts"])
    assert(
      readFileSync(`apps/api/src/${name}`, "utf8").includes(
        "app.use(httpMaintenance)",
      ),
    );
});
test("supervisor request control is read only and ACK mounts are service-specific", () => {
  const compose = readFileSync("deployment/compose.yml", "utf8");
  const controlMounts = compose
    .split("\n")
    .filter((line) => line.includes("/control:/var/lib/cra-maintenance"));
  assert(controlMounts.length > 40);
  assert(
    controlMounts.every((line) => line.includes("/var/lib/cra-maintenance:ro")),
  );
  const inventory = JSON.parse(
    readFileSync("deployment/service-inventory.json", "utf8"),
  );
  for (const service of inventory.services.filter((s) =>
    ["lease", "http", "cycle"].includes(s.drain),
  ))
    assert(
      compose.includes(`/acks/${service.id}:/var/lib/cra-maintenance-ack`),
    );
  assert(!compose.includes("/acks:/"));
});

test("agent hourly nonce pruning stays behind the tracked lifecycle", () => {
  const entry = readFileSync("apps/api/src/agent-main.ts", "utf8");
  assert(entry.includes("startAgentNonceMaintenance(repository)"));
  assert(!entry.includes("void repository.pruneExpiredNonces()"));
  assert(
    readFileSync(
      "apps/api/src/upgrades/maintenance/agent-nonce-maintenance.ts",
      "utf8",
    ).includes("maintenanceRun(() => repository.pruneExpiredNonces())"),
  );
});
test("the same web image uses server runtime Supabase configuration without installation build URLs", () => {
  const docker = readFileSync("deployment/Dockerfile", "utf8");
  assert(!docker.includes("PUBLIC_ORIGIN"));
  assert(!docker.includes("NEXT_PUBLIC_SUPABASE_URL="));
  assert(!docker.includes("NEXT_PUBLIC_API_ORIGIN="));
  assert(
    docker.includes(
      "NEXT_PUBLIC_ENABLE_MOCKS=false API_ORIGIN=http://api:3333",
    ),
  );
  const middleware = readFileSync("apps/web/middleware.ts", "utf8");
  assert(
    middleware.indexOf("process.env.SUPABASE_INTERNAL_URL") <
      middleware.indexOf("process.env.NEXT_PUBLIC_SUPABASE_URL"),
  );
});
test("control tools come from a pinned PG17 closure without a Debian PG15 fallback", () => {
  const docker = readFileSync("deployment/Dockerfile", "utf8");
  const control = docker.slice(docker.indexOf("FROM api AS control"));
  assert(docker.includes("ARG POSTGRES_TOOLS_IMAGE\n"));
  assert(!docker.includes("ARG POSTGRES_TOOLS_IMAGE="));
  assert(docker.includes("FROM ${POSTGRES_TOOLS_IMAGE} AS postgres-tools"));
  assert(control.includes("COPY --from=postgres-tools /nix /nix"));
  assert(!/apt-get install[^\n]*postgresql-client/.test(docker));
  for (const tool of ["psql", "pg_dump"])
    assert(
      control.includes(
        `/nix/var/nix/profiles/default/bin/${tool} /usr/bin/${tool}`,
      ),
    );
  assert(control.includes("@sha256:[a-f0-9]{64}$"));
  assert(control.includes("psql \\(PostgreSQL\\) 17\\."));
  assert(control.includes("pg_dump \\(PostgreSQL\\) 17\\."));
  assert(
    !docker
      .slice(0, docker.indexOf("FROM api AS control"))
      .includes("COPY --from=postgres-tools /nix /nix"),
  );
});
