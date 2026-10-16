import { backupDigest } from "../repository/encrypted-backup.repository";

/** Physical recovery may advance prelogged sequence caches; it must never rewind them. */
export function recoveryCatalogMatches(
  expected: unknown,
  actual: unknown,
): boolean {
  if (
    !expected ||
    !actual ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  )
    return false;
  const { sequences: before, ...left } = expected as Record<string, unknown>;
  const { sequences: after, ...right } = actual as Record<string, unknown>;
  if (
    backupDigest(left) !== backupDigest(right) ||
    !Array.isArray(before) ||
    !Array.isArray(after) ||
    before.length !== after.length
  )
    return false;
  return before.every((value, index) => {
    const { last_value: oldValue, ...oldDefinition } = value as Record<
      string,
      unknown
    >;
    const { last_value: newValue, ...newDefinition } = after[index] as Record<
      string,
      unknown
    >;
    if (backupDigest(oldDefinition) !== backupDigest(newDefinition))
      return false;
    if (oldValue === null || newValue === null || oldDefinition.cycle === true)
      return oldValue === newValue;
    const integer = (input: unknown) =>
      typeof input === "string" && /^-?\d+$/.test(input)
        ? BigInt(input)
        : typeof input === "number" && Number.isSafeInteger(input)
          ? BigInt(input)
          : null;
    const prior = integer(oldValue);
    const next = integer(newValue);
    const increment = integer(oldDefinition.increment_by);
    return (
      prior !== null &&
      next !== null &&
      increment !== null &&
      (increment > 0n ? next >= prior : next <= prior)
    );
  });
}
