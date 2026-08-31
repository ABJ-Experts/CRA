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

const migrationSql = (): string =>
  readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((migration) =>
      readFileSync(resolve(migrationsDirectory, migration), "utf8"),
    )
    .join("\n");

const latestMaterializeSnapshotFunctionSql = (): string => {
  const migration = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .reverse()
    .find((file) =>
      readFileSync(resolve(migrationsDirectory, file), "utf8").includes(
        "function public.materialize_organization_export_snapshot_atomic",
      ),
    );

  if (!migration) {
    throw new Error("missing organization export snapshot materializer");
  }

  return readFileSync(resolve(migrationsDirectory, migration), "utf8");
};

const lockedSnapshotTables = (functionSql: string): readonly string[] => {
  const lockList = functionSql.match(
    /lock table\s+([\s\S]*?)\s+in share mode;/i,
  )?.[1];
  if (!lockList) throw new Error("snapshot materializer has no table lock set");

  return Object.freeze(
    [...lockList.matchAll(/public\.([a-z_]+)/g)]
      .map((match) => match[1])
      .filter((table): table is string => Boolean(table)),
  );
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
    const sql = migrationSql();

    for (const source of exportSourceRegistry) {
      for (const table of source.tables) {
        expect(sql).toContain(`('${source.sourceId}', '${table}'`);
      }
    }
    expect(sql).toContain("materialize_organization_export_snapshot_atomic");
    expect(sql).toContain("m1_export_redact_jsonb");
  });

  it("locks every registered physical table in the latest snapshot materializer", () => {
    const lockedTables = lockedSnapshotTables(
      latestMaterializeSnapshotFunctionSql(),
    );
    const registeredTables = exportSourceRegistry.flatMap(
      (source) => source.tables,
    );

    expect(lockedTables).toEqual(expect.arrayContaining(registeredTables));
  });
});
