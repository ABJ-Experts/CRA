import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { normalizeDatabaseTypes } from "../../apps/infrastructure/scripts/normalize-database-types.mjs";

const root = process.cwd();

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`      ${name}:`);
  const end = source.indexOf(`      ${nextName}:`, start);
  assert.notEqual(start, -1, `Missing generated ${name} function`);
  assert.notEqual(end, -1, `Missing generated function after ${name}`);
  return source.slice(start, end);
}

const generatedFixture = `export type Database = {
  public: {
    Functions: {
      accept_invitation_atomic: {
        Args: { p_email: string; p_token_hash: string; p_user_id: string }
        Returns: {
          invitation_id: string
          organization_id: string
          organization_name: string
          organization_slug: string
          outcome: string
        }[]
      }
      bump_session_epoch: { Args: { p_user_id: string }; Returns: undefined }
      claim_mfa_recovery: {
        Args: { p_code_hash: string; p_user_id: string }
        Returns: {
          auth_user_id: string
          operation_id: string
          outcome: string
          status: string
        }[]
      }
      clear_login_attempts: { Args: { p_email: string }; Returns: undefined }
      consume_password_reset: {
        Args: { p_token_hash: string }
        Returns: {
          auth_user_id: string
          outcome: string
          user_id: string
        }[]
      }
      expire_stale_invitations: { Args: never; Returns: number }
    }
    Tables: {
      organizations: { Row: { organization_id: string } }
    }
  }
}
`;

test("normalizes declared nullable RPC result columns", () => {
  const normalized = normalizeDatabaseTypes(generatedFixture);

  for (const field of [
    "invitation_id",
    "organization_id",
    "organization_name",
    "organization_slug",
  ]) {
    assert.match(normalized, new RegExp(`          ${field}: string \\| null`));
  }
  assert.match(normalized, /          outcome: string/);
  assert.match(
    normalized,
    /organizations: \{ Row: \{ organization_id: string \} \}/,
  );
  assert.equal(normalized.at(-1), "\n");
  assert.notEqual(normalized.at(-2), "\n");
  assert.equal(normalizeDatabaseTypes(normalized), normalized);
  assert.match(normalized, /          auth_user_id: string \| null/);
  assert.match(normalized, /          user_id: string \| null/);
  assert.match(normalized, /          operation_id: string \| null/);
  assert.match(normalized, /          status: string \| null/);
});

test("fails closed when the generated function shape changes", () => {
  assert.throws(
    () => normalizeDatabaseTypes("export type Database = {}\n"),
    /accept_invitation_atomic/,
  );
  assert.throws(
    () =>
      normalizeDatabaseTypes(
        generatedFixture.replace("          invitation_id: string\n", ""),
      ),
    /invitation_id/,
  );
  assert.throws(
    () =>
      normalizeDatabaseTypes(
        generatedFixture.replace("          user_id: string\n", ""),
      ),
    /user_id/,
  );
  assert.throws(
    () =>
      normalizeDatabaseTypes(
        generatedFixture.replace("          operation_id: string\n", ""),
      ),
    /operation_id/,
  );
});

test("keeps both generated database type copies synchronized", async () => {
  const [infrastructureTypes, apiTypes, packageJson] = await Promise.all([
    readFile(
      join(root, "apps/infrastructure/supabase/types/database.types.ts"),
      "utf8",
    ),
    readFile(join(root, "apps/api/src/supabase/database.types.ts"), "utf8"),
    readFile(join(root, "apps/infrastructure/package.json"), "utf8").then(
      JSON.parse,
    ),
  ]);

  assert.match(
    packageJson.scripts["db:types"],
    /normalize-database-types\.mjs/,
  );
  assert.equal(
    apiTypes.replace(/^\/\* eslint-disable \*\/\n\/\/ GENERATED[^\n]*\n/, ""),
    infrastructureTypes,
  );
  for (const generatedTypes of [infrastructureTypes, apiTypes]) {
    const invitation = functionBlock(
      generatedTypes,
      "accept_invitation_atomic",
      "bump_session_epoch",
    );
    const passwordReset = functionBlock(
      generatedTypes,
      "consume_password_reset",
      "expire_stale_invitations",
    );
    const mfaRecovery = functionBlock(
      generatedTypes,
      "claim_mfa_recovery",
      "clear_login_attempts",
    );
    assert.match(invitation, /invitation_id: string \| null/);
    assert.match(invitation, /organization_id: string \| null/);
    assert.match(invitation, /organization_name: string \| null/);
    assert.match(invitation, /organization_slug: string \| null/);
    assert.match(passwordReset, /auth_user_id: string \| null/);
    assert.match(passwordReset, /user_id: string \| null/);
    assert.match(mfaRecovery, /auth_user_id: string \| null/);
    assert.match(mfaRecovery, /operation_id: string \| null/);
    assert.match(mfaRecovery, /status: string \| null/);
  }
});
