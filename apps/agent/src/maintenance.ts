import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  fstatSync,
  fsyncSync,
  constants,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
function readControl(path: string): unknown {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const details = fstatSync(fd);
    if (!details.isFile() || details.size > 4096)
      throw new Error("invalid maintenance request");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}
const request = z.strictObject({
  version: z.literal(1),
  generation: z.string().uuid(),
  closed: z.boolean(),
});
/** Called only between complete source+heartbeat cycles. Unknown requests stop new work. */
export function agentMaintenanceClosed(
  env: NodeJS.ProcessEnv = process.env,
  lastSuccessfulCycleAt: number | null = null,
): boolean {
  const directory = env.CRA_MAINTENANCE_DIRECTORY;
  if (!directory) return false;
  const ackDirectory = env.CRA_MAINTENANCE_ACK_DIRECTORY;
  if (!ackDirectory)
    throw new Error("private maintenance acknowledgement directory required");
  if (env.CRA_SERVICE_ID !== "agent")
    throw new Error("invalid maintenance service identity");
  try {
    const state = request.parse(readControl(join(directory, "request.json")));
    if (!state.closed) {
      const imageId = env.CRA_IMAGE_ID;
      if (imageId && /^sha256:[a-f0-9]{64}$/.test(imageId)) {
        const target = join(ackDirectory, "live.json"),
          temporary = `${target}.${process.pid}.tmp`;
        writeFileSync(
          temporary,
          JSON.stringify({
            version: 1,
            generation: state.generation,
            serviceId: "agent",
            pid: process.pid,
            imageId,
            claimsOpen: true,
            observedAt: new Date(lastSuccessfulCycleAt ?? 0).toISOString(),
            dependenciesReady: lastSuccessfulCycleAt !== null,
          }),
          { mode: 0o600, flush: true },
        );
        renameSync(temporary, target);
      }
      return false;
    }
    const target = join(ackDirectory, "ack.json");
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({
        version: 1,
        generation: state.generation,
        serviceId: "agent",
        pid: process.pid,
        claimsClosed: true,
        drained: true,
      }),
      { mode: 0o600, flush: true },
    );
    renameSync(temporary, target);
    const dir = openSync(
      ackDirectory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch {
    /* no acknowledgement on unknown state */
  }
  return true;
}
