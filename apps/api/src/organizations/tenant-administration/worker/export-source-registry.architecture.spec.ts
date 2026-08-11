import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  exportSourceExclusions,
  exportSourceRegistry,
  validateExportRegistryCoverage,
} from "./export-archive";

const migrationsDirectory = resolve(
  __dirname,
  "../../../../../infrastructure/supabase/migrations",
);
const snapshotMigration = resolve(
  migrationsDirectory,
  "20260810134400_m1_tenant_export_record_snapshot.sql",
);

const tenantTablesFromMigrations = (): readonly string[] => {
  const tables = new Set<string>(["organizations"]);
  for (const migration of readdirSync(migrationsDirectory).filter((file) =>
    file.endsWith(".sql"),
  )) {
    const sql = readFileSync(resolve(migrationsDirectory, migration), "utf8");
    const tablesInMigration = sql.matchAll(
      /create table(?: if not exists)? public\.([a-z_]+) \(([\s\S]*?)\n\);/g,
    );
    for (const table of tablesInMigration) {
      if (/\borganization_id\b/.test(table[2] ?? ""))
        tables.add(table[1] ?? "");
    }
  }
  return Object.freeze([...tables].filter(Boolean).sort());
};

describe("tenant export source registry architecture", () => {
  it("covers every current migration-defined tenant table or explains its exclusion", () => {
    const tenantTables = tenantTablesFromMigrations();

    expect(() => validateExportRegistryCoverage(tenantTables)).not.toThrow();
    expect(Object.values(exportSourceExclusions)).toEqual(
      expect.arrayContaining([expect.stringMatching(/security|session/i)]),
    );
    expect(exportSourceRegistry.flatMap((source) => source.tables)).toEqual(
      expect.arrayContaining(["organizations", "organization_members"]),
    );
  });

  it("keeps every physical registry mapping in the atomic SQL snapshot catalogue", () => {
    const sql = readFileSync(snapshotMigration, "utf8");

    for (const source of exportSourceRegistry) {
      for (const table of source.tables) {
        expect(sql).toContain(`('${source.sourceId}', '${table}'`);
      }
    }
    expect(sql).toContain("materialize_organization_export_snapshot_atomic");
    expect(sql).toContain("m1_export_redact_jsonb");
  });
});
