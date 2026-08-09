import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { normalizeDatabaseTypes } from "../../apps/infrastructure/scripts/normalize-database-types.mjs";

const root = process.cwd();

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
    }
    Tables: {
      organizations: { Row: { organization_id: string } }
    }
  }
}
`;

test("normalizes only nullable invitation result columns", () => {
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
    assert.match(generatedTypes, /invitation_id: string \| null/);
    assert.match(generatedTypes, /organization_id: string \| null/);
    assert.match(generatedTypes, /organization_name: string \| null/);
    assert.match(generatedTypes, /organization_slug: string \| null/);
  }
});
