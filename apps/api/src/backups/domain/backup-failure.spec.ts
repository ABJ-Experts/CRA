import { backupFailure } from "./backup-failure";
it("keeps fixed native failures actionable without exposing tool output", () => {
  expect(backupFailure(new Error("object_missing"))).toBe("object_missing");
  expect(backupFailure(new Error("object_integrity"))).toBe("object_corrupt");
  expect(backupFailure(new Error("password=canary"))).toBe("internal_failure");
  expect(backupFailure({ secret: true })).toBe("internal_failure");
});
