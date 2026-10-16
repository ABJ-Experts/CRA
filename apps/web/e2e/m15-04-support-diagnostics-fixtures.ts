import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DiagnosticBrowserFixture {
  readonly organizationId: string;
  readonly owner: {
    readonly userId: string;
    readonly authUserId: string;
    readonly email: string;
    readonly password: string;
  };
  readonly createdAt: string;
  readonly stackOrigin?: string;
  readonly purpose: "m15-04-browser-verification";
}
const root = fileURLToPath(new URL("../../../", import.meta.url));
interface LocalStackStatus {
  API_URL: string;
  SERVICE_ROLE_KEY: string;
  DB_CONTAINER: string;
}
async function localStack(statusPath?: string): Promise<LocalStackStatus> {
  const status = statusPath
    ? JSON.parse(await readFile(statusPath, "utf8"))
    : JSON.parse(
        execFileSync(
          "pnpm",
          [
            "--filter",
            "infrastructure",
            "exec",
            "supabase",
            "status",
            "--output",
            "json",
          ],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      );
  const origin = new URL(status.API_URL);
  const database = new Map([
    ["http://127.0.0.1:54321", "supabase_db_cra"],
    ["http://127.0.0.1:56321", "cra_m15_04_db"],
  ]).get(origin.origin);
  assert.ok(
    database,
    "Only the explicitly authorized local stacks are supported.",
  );
  assert.equal(status.DB_CONTAINER ?? database, database);
  assert.ok(
    status.SERVICE_ROLE_KEY,
    "A local credential is required; never logged or written.",
  );
  return { ...status, DB_CONTAINER: database };
}
function sql(stack: LocalStackStatus, statement: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      stack.DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
function initializeFixtureOrganization(
  stack: LocalStackStatus,
  fixture: DiagnosticBrowserFixture,
) {
  const org = literal(fixture.organizationId);
  const actor = literal(fixture.owner.userId);
  const email = literal(fixture.owner.email);
  sql(
    stack,
    `begin;
    do $$ begin
      if not exists(select 1 from public.organizations o join public.organization_members m on m.organization_id=o.id join public.users u on u.id=m.user_id where o.id=${org}::uuid and o.slug like 'm15-04-browser-%' and m.user_id=${actor}::uuid and m.role='owner' and u.email=${email}) then
        raise exception 'Only the verified task fixture organization can be initialized';
      end if;
    end $$;
    insert into public.organization_legal_profiles(organization_id,legal_name,registered_address_line_1,registered_address_locality,registered_address_postal_code,registered_address_country,main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,created_by,updated_by)
    values(${org}::uuid,'M15-04 verification fixture '||${org},'1 Verification Way','Berlin','10115','DE','DE','Diagnostics Fixture',${email},${actor}::uuid,${actor}::uuid)
    on conflict(organization_id) do nothing;
    update public.organizations o set name=p.legal_name,legal_identity_digest=public.m1_legal_identity_digest(p.legal_name,p.registered_address_line_1,p.registered_address_line_2,p.registered_address_locality,p.registered_address_administrative_area,p.registered_address_postal_code,p.registered_address_country,p.main_establishment_country)
    from public.organization_legal_profiles p where o.id=${org}::uuid and p.organization_id=o.id and o.legal_identity_digest is null;
    insert into public.organization_onboarding(organization_id) values(${org}::uuid) on conflict(organization_id) do nothing;
    insert into public.organization_onboarding_stages(organization_id,stage,stage_order,status,block_reason)
    select ${org}::uuid,stage,stage_order,status,block_reason from(values
      ('organization_details'::text,1::smallint,'pending'::text,null::text),
      ('first_product',2::smallint,'blocked','awaiting_prior_stage'),
      ('first_sbom',3::smallint,'blocked','awaiting_prior_stage'),
      ('invite_team',4::smallint,'blocked','awaiting_prior_stage'),
      ('completed',5::smallint,'blocked','awaiting_prior_stage')
    ) stages(stage,stage_order,status,block_reason) on conflict(organization_id,stage) do nothing;
    select public.reconcile_organization_onboarding(${org}::uuid,${actor}::uuid);
    commit;`,
  );
  assert.equal(
    sql(
      stack,
      `select count(*) from public.organization_onboarding_stages where organization_id=${org}::uuid;`,
    ),
    "5",
  );
}
async function createFixture(
  path: string,
  stack: LocalStackStatus,
): Promise<DiagnosticBrowserFixture> {
  const suffix = randomUUID().replaceAll("-", "");
  const organizationId = randomUUID();
  const email = `e2e-m15-04-${suffix}@cra.test`;
  const password = `M15diag-${randomBytes(18).toString("base64url")}!2`;
  const status = stack;
  const origin = new URL(status.API_URL);
  const response = await fetch(new URL("/auth/v1/admin/users", origin), {
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
      user_metadata: {
        first_name: "Diagnostics",
        last_name: "Fixture",
        username: `m15diag${suffix.slice(0, 16)}`,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(
    response.status,
    200,
    "Task-owned Auth admin creation must succeed.",
  );
  const authUser = (await response.json()) as { id: string };
  assert.match(authUser.id, /^[0-9a-f-]{36}$/);
  const userId = sql(
    stack,
    `select id from public.users where auth_user_id=${literal(authUser.id)}::uuid and email=${literal(email)};`,
  );
  assert.match(
    userId,
    /^[0-9a-f-]{36}$/,
    "Auth trigger must create exactly one application profile.",
  );
  sql(
    stack,
    `begin;
    update public.users u set email_verified_at=clock_timestamp() where u.id=${literal(userId)}::uuid and u.auth_user_id=${literal(authUser.id)}::uuid and u.email=${literal(email)} and u.email_verified_at is null;
    insert into public.organizations(id,name,slug) values(${literal(organizationId)}::uuid,'M15-04 browser verification',${literal(`m15-04-browser-${suffix}`)});
    insert into public.organization_members(organization_id,user_id,role) values(${literal(organizationId)}::uuid,${literal(userId)}::uuid,'owner');
    commit;`,
  );
  assert.equal(
    sql(
      stack,
      `select count(*) from public.organization_members where organization_id=${literal(organizationId)}::uuid and user_id=${literal(userId)}::uuid and role='owner';`,
    ),
    "1",
  );
  const fixture: DiagnosticBrowserFixture = {
    organizationId,
    owner: { userId, authUserId: authUser.id, email, password },
    createdAt: new Date().toISOString(),
    stackOrigin: origin.origin,
    purpose: "m15-04-browser-verification",
  };
  initializeFixtureOrganization(stack, fixture);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  await chmod(path, 0o600);
  return fixture;
}
export async function diagnosticBrowserFixture(
  path: string,
  statusPath?: string,
) {
  const stack = await localStack(statusPath);
  try {
    const existing = JSON.parse(
      await readFile(path, "utf8"),
    ) as DiagnosticBrowserFixture;
    assert.equal(existing.purpose, "m15-04-browser-verification");
    assert.equal(
      existing.stackOrigin ?? "http://127.0.0.1:54321",
      new URL(stack.API_URL).origin,
    );
    assert.match(existing.organizationId, /^[0-9a-f-]{36}$/);
    assert.equal(
      sql(
        stack,
        `select count(*) from public.organization_members m join public.users u on u.id=m.user_id where m.organization_id=${literal(existing.organizationId)}::uuid and u.id=${literal(existing.owner.userId)}::uuid and u.email=${literal(existing.owner.email)} and m.role='owner';`,
      ),
      "1",
    );
    assert.match(existing.owner.email, /^e2e-m15-04-[a-f0-9]{32}@cra\.test$/);
    sql(
      stack,
      `update public.users u set email_verified_at=clock_timestamp() from auth.users a where u.id=${literal(existing.owner.userId)}::uuid and u.auth_user_id=a.id and a.id=${literal(existing.owner.authUserId)}::uuid and u.email=${literal(existing.owner.email)} and a.email_confirmed_at is not null and u.email_verified_at is null;`,
    );
    initializeFixtureOrganization(stack, existing);
    return existing;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    return createFixture(path, stack);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const path = resolve(
    process.argv[2] ??
      resolve(root, ".superpowers/sdd/m15-04/browser-fixture.private.json"),
  );
  const fixture = await diagnosticBrowserFixture(path, process.argv[3]);
  console.log(
    JSON.stringify({
      manifestPath: path,
      organizationId: fixture.organizationId,
      purpose: fixture.purpose,
    }),
  );
}
// Deliberately no destructive teardown: fixture tenant and diagnostic audit
// tombstones remain for verification under the normal retention policy.
