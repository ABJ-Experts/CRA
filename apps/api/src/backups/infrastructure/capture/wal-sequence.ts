import { BackupExecutionError } from "../../application/backup-execution.port";

/** PG17 default 16MiB segments: 256 segments per 2^32-byte WAL log. */
export function walOrdinal(name: string): bigint {
  if (!/^[A-F0-9]{24}$/.test(name)) throw new BackupExecutionError("wal_gap");
  const segment = BigInt(`0x${name.slice(16)}`);
  if (segment > 255n) throw new BackupExecutionError("wal_gap");
  return BigInt(`0x${name.slice(8, 16)}`) * 256n + segment;
}

export function walEndLsn(name: string): string {
  const bytes = (walOrdinal(name) + 1n) * 16777216n;
  return `${(bytes >> 32n).toString(16).toUpperCase()}/${(bytes & 0xffffffffn).toString(16).toUpperCase()}`;
}

export function assertWalSequence(names: readonly string[]): void {
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    walOrdinal(name);
    if (
      index > 0 &&
      (name.slice(0, 8) !== names[index - 1]!.slice(0, 8) ||
        walOrdinal(name) !== walOrdinal(names[index - 1]!) + 1n)
    )
      throw new BackupExecutionError("wal_gap");
  }
}
