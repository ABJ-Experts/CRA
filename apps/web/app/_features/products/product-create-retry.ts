export type ProductCreateAttempt = Readonly<{
  fingerprint: string;
  key: string;
}>;
/** Call only with parsed input without its idempotency key. No command is replayed automatically. */
export function resolveProductCreateAttempt(
  previous: ProductCreateAttempt | null,
  scope: string,
  payload: Readonly<Record<string, unknown>>,
  newKey: () => string = () => crypto.randomUUID(),
): ProductCreateAttempt {
  const fingerprint = JSON.stringify([scope, payload]);
  return previous?.fingerprint === fingerprint
    ? previous
    : Object.freeze({ fingerprint, key: newKey() });
}
