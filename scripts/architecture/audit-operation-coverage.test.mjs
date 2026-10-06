import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { verifyAuditOperationCoverage } from "./audit-operation-coverage.mjs";

async function fixture(t, registry) {
  const root = await mkdtemp(join(tmpdir(), "cra-audit-coverage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = "apps/api/src/orders/orders.controller.ts";
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(
    join(root, path),
    [
      '@Controller("orders")',
      "class OrdersController {",
      '  @Post(":id/approve")',
      "  approve() { return true; }",
      "}",
    ].join("\n"),
  );
  await mkdir(join(root, "docs/architecture"), { recursive: true });
  await writeFile(
    join(root, "docs/architecture/m13-01-operation-register.json"),
    JSON.stringify(registry),
  );
  return root;
}

const operation = Object.freeze({
  id: "apps/api/src/orders/orders.controller.ts#OrdersController.approve:POST:orders/:id/approve",
  authority: [
    {
      kind: "transactional-audit",
      evidence: "apps/api/src/orders/orders.controller.ts",
      symbol: "approve",
    },
  ],
});

test("accepts exactly one registered authority per mutation route", async (t) => {
  const root = await fixture(t, { routes: [operation], workers: [], rpcs: [] });
  assert.deepEqual(await verifyAuditOperationCoverage(root), []);
});

test("fails when a new route has no registration", async (t) => {
  const root = await fixture(t, { routes: [], workers: [], rpcs: [] });
  assert.match(
    (await verifyAuditOperationCoverage(root)).join("\n"),
    /unregistered mutation/,
  );
});

test("fails duplicate registrations and more than one authority", async (t) => {
  const root = await fixture(t, {
    routes: [
      operation,
      {
        ...operation,
        authority: [...operation.authority, ...operation.authority],
      },
    ],
    workers: [],
    rpcs: [],
  });
  const errors = (await verifyAuditOperationCoverage(root)).join("\n");
  assert.match(errors, /duplicate registration/);
  assert.match(errors, /exactly one authority/);
});

test("fails stale registration after a route is renamed", async (t) => {
  const root = await fixture(t, {
    routes: [{ ...operation, id: operation.id.replace("approve", "grant") }],
    workers: [],
    rpcs: [],
  });
  const errors = (await verifyAuditOperationCoverage(root)).join("\n");
  assert.match(errors, /unregistered mutation/);
  assert.match(errors, /stale registration/);
});

test("fails when the controller base path changes", async (t) => {
  const root = await fixture(t, { routes: [operation], workers: [], rpcs: [] });
  await writeFile(
    join(root, "apps/api/src/orders/orders.controller.ts"),
    '@Controller("purchases")\nclass OrdersController { @Post(":id/approve") approve() {} }\n',
  );
  const errors = (await verifyAuditOperationCoverage(root)).join("\n");
  assert.match(errors, /unregistered mutation/);
  assert.match(errors, /stale registration/);
});

test("requires an evidence path for claimed authoritative writers", async (t) => {
  const root = await fixture(t, {
    routes: [
      {
        ...operation,
        authority: [{ kind: "transactional-audit", evidence: "missing.sql" }],
      },
    ],
    workers: [],
    rpcs: [],
  });
  assert.match(
    (await verifyAuditOperationCoverage(root)).join("\n"),
    /missing evidence/,
  );
});

test("requires a source symbol present in evidence", async (t) => {
  const root = await fixture(t, {
    routes: [{
      ...operation,
      authority: [{
        kind: "transactional-audit",
        evidence: "apps/api/src/orders/orders.controller.ts",
        symbol: "missing_audit_writer",
      }],
    }],
    workers: [],
    rpcs: [],
  });
  assert.match(
    (await verifyAuditOperationCoverage(root)).join("\n"),
    /missing source symbol/,
  );
});

test("requires source symbols for durable authorities", async (t) => {
  const root = await fixture(t, {
    routes: [{
      ...operation,
      authority: [{
        kind: "transactional-audit",
        evidence: "apps/api/src/orders/orders.controller.ts",
      }],
    }],
    workers: [],
    rpcs: [],
  });
  assert.match(
    (await verifyAuditOperationCoverage(root)).join("\n"),
    /missing source symbol/,
  );
});

test("rejects an unresolved mutation authority", async (t) => {
  const root = await fixture(t, {
    routes: [
      {
        ...operation,
        authority: [
          {
            kind: "legacy-unverified",
            evidence: "apps/api/src/orders/orders.controller.ts",
          },
        ],
      },
    ],
    workers: [],
    rpcs: [],
  });
  assert.match(
    (await verifyAuditOperationCoverage(root)).join("\n"),
    /unresolved audit authority/,
  );
});

test("rejects an unreviewed best-effort mutation authority", async (t) => {
  const root = await fixture(t, {
    routes: [{
      ...operation,
      authority: [{
        kind: "best-effort",
        evidence: "apps/api/src/orders/orders.controller.ts",
        symbol: "approve",
      }],
    }],
    workers: [],
    rpcs: [],
  });
  assert.match(
    (await verifyAuditOperationCoverage(root)).join("\n"),
    /unapproved best-effort authority/,
  );
});

test("fails when a semantic worker has no registration", async (t) => {
  const root = await fixture(t, { routes: [operation], workers: [], rpcs: [] });
  const worker = "apps/api/src/orders/worker/order-worker.ts";
  await mkdir(dirname(join(root, worker)), { recursive: true });
  await writeFile(join(root, worker), "export class OrderWorker {}\n");
  assert.match(
    (await verifyAuditOperationCoverage(root)).join("\n"),
    /unregistered worker/,
  );
});

test("the repository mutation surface is fully registered", async () => {
  assert.deepEqual(await verifyAuditOperationCoverage(process.cwd()), []);
});
