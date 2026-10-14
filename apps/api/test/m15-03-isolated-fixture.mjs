// Disposable local fixtures only. Never connects to the original CRA database.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  generateKeyPairSync,
  createHash,
  sign,
  randomUUID,
  randomBytes,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const runtime = resolve(process.argv[2]);
assert.ok(
  runtime.endsWith("/2026-10-14-m15-03-scoped-operator-system-health/isolated"),
);
const container = "supabase_db_cra_m15_03_isolated_20261014";
const status = JSON.parse(
  await readFile(`${runtime}/stack-status.private.json`, "utf8"),
);
assert.equal(status.API_URL, "http://127.0.0.1:55321");
function sql(query) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: query, encoding: "utf8" },
  );
}
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const priorManifest = await readFile(
  `${runtime}/fixture-manifest.private.json`,
  "utf8",
).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
assert.equal(
  priorManifest,
  null,
  "Fixture initialization is one-time; preserve retained test history",
);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const kid = "m15-03-isolated-task-only";
const issuer = "m15-03-isolated-verification";
const instanceId = "15555555-5555-4555-8555-555555555555";
const publicJwk = publicKey.export({ format: "jwk" });
await writeFile(
  `${runtime}/trust-public.json`,
  JSON.stringify({ issuer, keys: [{ kid, ...publicJwk }] }, null, 2),
  { mode: 0o600 },
);
await writeFile(
  `${runtime}/private-jwk.private.json`,
  JSON.stringify({ kid, ...privateKey.export({ format: "jwk" }) }),
  { mode: 0o600 },
);
sql(
  `drop trigger if exists on_auth_user_created on auth.users; drop trigger if exists on_auth_user_email_changed on auth.users; create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user(); create trigger on_auth_user_email_changed after update of email on auth.users for each row execute function public.handle_user_email_change();`,
);
let manifest = {
  taskOwned: true,
  databaseOrigin: status.API_URL,
  apiOrigin: "http://127.0.0.1:3339",
  webOrigin: "http://127.0.0.1:3008",
  instanceId,
  jwtSecretFile: `${runtime}/jwt-secret.private`,
};
for (const type of [
  "restricted",
  "missing",
  "expired",
  "owner",
  "member",
  "large",
]) {
  const email =
    type === "owner"
      ? "owner@cra.test"
      : type === "member"
        ? "member@cra.test"
        : `m15-03-${type}@isolated.cra.test`;
  const password = `M15-${randomBytes(24).toString("base64url")}!`;
  const response = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: status.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: "M15", last_name: type },
    }),
  });
  let auth = await response.json();
  if (response.status !== 200) {
    const list = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
      headers: {
        apikey: status.SERVICE_ROLE_KEY,
        Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      },
    });
    auth = (await list.json()).users.find((u) => u.email === email);
    assert.ok(auth, `Existing disposable user ${type}`);
  }
  const userId = sql(
    `update public.users set email_verified_at=clock_timestamp() where auth_user_id=${q(auth.id)} returning id;`,
  ).split("\n")[0];
  const existing = sql(
    `select organization_id from public.organization_members where user_id=${q(userId)} limit 1;`,
  ).trim();
  const organizationId = existing || randomUUID();
  if (!existing)
    sql(
      `insert into public.organizations(id,name,slug) values (${q(organizationId)},${q(`M15-03 isolated ${type}`)},${q(`m15-03-${type}-${organizationId.slice(0, 8)}`)}); insert into public.organization_members(organization_id,user_id,role) values(${q(organizationId)},${q(userId)},'owner');`,
    );
  manifest = {
    ...manifest,
    [type]: { email, password, organizationId, userId },
  };
  if (type === "member")
    sql(
      `insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(${q(organizationId)},'owner','{"can_view_system_health":false}') on conflict do nothing;`,
    );
  if (type === "restricted")
    sql(
      `insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(${q(organizationId)},'owner','{"can_view_system_health":true,"can_view_reporting":false,"can_view_findings":false,"can_view_licensing":false,"can_view_products":false,"can_view_evidence":false,"can_view_connectors":false,"can_view_sboms":false,"can_export_organization":false}') on conflict do nothing;`,
    );
  if (type === "expired") {
    const now = Date.now(),
      day = 86400000;
    const claims = {
      schemaVersion: 1,
      licenseId: randomUUID(),
      sequence: Number(
        sql(
          `select coalesce(max(issuance_sequence),0)+1 from public.organization_license_states where organization_id=${q(organizationId)};`,
        ).trim(),
      ),
      issuer,
      organizationId,
      instanceId,
      issuedAt: new Date(now - 100 * day).toISOString(),
      startsAt: new Date(now - 100 * day).toISOString(),
      expiresAt: new Date(now - 40 * day).toISOString(),
      graceDays: 30,
      entitlements: ["administration", "products", "evidence", "reporting"],
      limits: { activeMembers: null, products: null, storageBytes: null },
    };
    const header = Buffer.from(
      JSON.stringify({ alg: "EdDSA", kid, typ: "CRA-LICENCE+JWS" }),
    ).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const unsigned = `${header}.${payload}`;
    const artifact = `${unsigned}.${sign(null, Buffer.from(unsigned), privateKey).toString("base64url")}`;
    const digest = createHash("sha256").update(artifact).digest("hex");
    sql(
      `insert into public.organization_license_states(organization_id,artifact,artifact_digest,artifact_object_path,verified_claims,issuance_sequence,version,time_high_water_at,storage_accounting_ready) values(${q(organizationId)},${q(artifact)},${q(digest)},${q(`${organizationId}/${digest}.jws`)},${q(JSON.stringify(claims))}::jsonb,${claims.sequence},1,clock_timestamp(),true) on conflict (organization_id) do update set artifact=excluded.artifact,artifact_digest=excluded.artifact_digest,artifact_object_path=excluded.artifact_object_path,verified_claims=excluded.verified_claims,issuance_sequence=excluded.issuance_sequence,version=public.organization_license_states.version+1;`,
    );
    manifest = {
      ...manifest,
      expired: {
        ...manifest.expired,
        readPath: "/api/v1/products",
        exportPath: "/api/v1/exports",
        exportInput: {
          source: "products.registry",
          context: {},
          filters: { archived: "true" },
          format: "csv",
          idempotencyKey: randomUUID(),
        },
        exportStatus: 202,
        receiptField: "data",
        licenseDigest: digest,
      },
    };
  }
}
// Retained archived source rows model history, without admitting unlicensed growth.
for (const type of ["owner", "expired"]) {
  const f = manifest[type],
    entity = randomUUID(),
    product = randomUUID(),
    release = randomUUID();
  sql(
    `insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by)values(${q(entity)},${q(f.organizationId)},${q(`fixture-${entity.slice(0, 8)}`)},'Isolated source fixture','needs_completion','inactive',${q(f.userId)},${q(f.userId)}); insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,archived_at,created_by,updated_by)values(${q(product)},${q(f.organizationId)},${q(entity)},0,'{"identifier":"fixture","legalName":"Isolated task fixture entity","mainEstablishmentCountry":"DE"}','Isolated retained product',${q(product)},'component',${q(f.userId)},clock_timestamp(),${q(f.userId)},${q(f.userId)}); insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,created_by,updated_by)values(${q(release)},${q(f.organizationId)},${q(product)},${q(entity)},0,'{}','Retained','1',${q(f.userId)},${q(f.userId)});`,
  );
  manifest = {
    ...manifest,
    [type]: { ...manifest[type], productId: product, releaseId: release },
  };
}
await writeFile(
  `${runtime}/fixture-manifest.private.json`,
  JSON.stringify(manifest, null, 2),
  { mode: 0o600 },
);
console.log(
  "Disposable fixture manifest ready; all credentials remain in private runtime files.",
);
