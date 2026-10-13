import { strict as assert } from "node:assert";
import { test } from "node:test";
import { prepareLegacySql } from "./prepare-legacy-sql.mjs";

test("fixture runs inside the suite transaction, after each BEGIN", () => {
  assert.equal(
    prepareLegacySql("-- test\nbegin;\nselect 1;\nrollback;", "-- fixture"),
    "-- test\nbegin;\n-- fixture\n\nselect 1;\nrollback;",
  );
});
test("unsafe or nontransactional suites cannot receive fixtures", () => {
  for (const source of ["begin;\ncommit;", "begin;\ncommit;\nrollback;"]) {
    assert.throws(() => prepareLegacySql(source, "fixture"), /BEGIN\/ROLLBACK/);
  }
});

test("each independent rollback transaction receives a fresh fixture", () => {
  assert.equal(
    (
      prepareLegacySql(
        "begin;\nrollback;\nbegin;\nrollback;",
        "-- fixture",
      ).match(/-- fixture/g) ?? []
    ).length,
    2,
  );
});

test("rollback sharing a statement line is accepted", () => {
  assert.match(
    prepareLegacySql("begin;\nselect 1;rollback;", "-- fixture"),
    /-- fixture/,
  );
});
test("commit sharing a statement line is rejected", () => {
  assert.throws(
    () => prepareLegacySql("begin;\nselect 1;commit;\nrollback;", "fixture"),
    /BEGIN\/ROLLBACK/,
  );
});

test("every fixture transaction must have a rollback", () => {
  assert.throws(
    () => prepareLegacySql("begin;\nrollback;\nbegin;\nselect 1;", "fixture"),
    /BEGIN\/ROLLBACK/,
  );
});

test("catalog-only suites are passed through without fixture state", () => {
  assert.equal(prepareLegacySql("select 1;", "fixture"), "select 1;");
});
