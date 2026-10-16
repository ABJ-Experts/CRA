const keys = [
  "cra.backup.feature",
  "cra.backup.instance",
  "cra.backup.verification-run",
  "cra.backup.restore",
  "cra.backup.staging",
  "cra.backup.owner-host",
  "cra.backup.owner-pid",
] as const;
export function sameRecoveryOwnership(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  return keys.every(
    (key) => typeof left[key] === "string" && left[key] === right[key],
  );
}

/** An unrelated endpoint blocks cleanup; it is never forcibly detached from the network. */
export async function ownedRecoveryProbeMembers(
  network: string,
  targetName: string,
  targetExists: boolean,
  labels: Readonly<Record<string, string>>,
  run: (args: readonly string[]) => Promise<string>,
): Promise<readonly string[] | null> {
  const parsed: unknown = JSON.parse(
    await run([
      "network",
      "inspect",
      "--format",
      "{{json .Containers}}",
      network,
    ]),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const members: string[] = [];
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (
      !value ||
      typeof value !== "object" ||
      !("Name" in value) ||
      typeof value.Name !== "string"
    )
      return null;
    const name = value.Name;
    if (name === targetName && targetExists) continue;
    const match =
      /^(cra-backup-probe-[a-f0-9-]{36})-(?:auth|rest|storage|runtime-create|runtime-verify)$/.exec(
        name,
      );
    if (!match) return null;
    const candidate: unknown = JSON.parse(
      await run(["inspect", "--format", "{{json .Config.Labels}}", name]),
    );
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return null;
    const ownership = candidate as Readonly<Record<string, string>>;
    if (
      !sameRecoveryOwnership(labels, ownership) ||
      ownership["cra.backup.probe"] !== match[1]
    )
      return null;
    members.push(name);
  }
  return members;
}
