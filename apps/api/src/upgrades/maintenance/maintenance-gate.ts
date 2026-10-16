import {
  readFileSync,
  renameSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  fstatSync,
  constants,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
const requestSchema = z.strictObject({
  version: z.literal(1),
  generation: z.string().uuid(),
  closed: z.boolean(),
});
type Request = Readonly<{ generation: string; closed: boolean }>;
type Ack = Readonly<{
  version: 1;
  generation: string;
  serviceId: string;
  pid: number;
  claimsClosed: true;
  drained: true;
}>;
/** A lease spans the entire source operation, including its durable completion. */
export class MaintenanceGate {
  private active = 0;
  private acknowledged: string | null = null;
  constructor(
    private readonly serviceId: string,
    private readonly read: () => Request | null,
    private readonly acknowledge: (ack: Ack) => Promise<void> | void,
  ) {
    if (!/^[a-z][a-z0-9-]{0,100}$/.test(serviceId))
      throw new Error("invalid maintenance service identity");
  }
  private state(): Request {
    try {
      return this.read() ?? { generation: "disabled", closed: false };
    } catch {
      return { generation: "unknown", closed: true };
    }
  }
  enter(allowClosed?: (generation: string) => boolean): (() => void) | null {
    const state = this.state();
    if (
      state.closed &&
      (!allowClosed ||
        state.generation === "unknown" ||
        !allowClosed(state.generation))
    )
      return null;
    this.active += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active -= 1;
        void this.poll().catch(() => {});
      }
    };
  }
  async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    const leave = this.enter();
    if (!leave) {
      await this.poll();
      return undefined;
    }
    try {
      return await operation();
    } finally {
      leave();
    }
  }
  async poll(): Promise<void> {
    const state = this.state();
    if (!state.closed) {
      this.acknowledged = null;
      return;
    }
    if (
      state.generation === "unknown" ||
      this.active !== 0 ||
      this.acknowledged === state.generation
    )
      return;
    await this.acknowledge({
      version: 1,
      generation: state.generation,
      serviceId: this.serviceId,
      pid: process.pid,
      claimsClosed: true,
      drained: true,
    });
    this.acknowledged = state.generation;
  }
}
function mountedRequest(path: string): unknown {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4096)
      throw new Error("invalid maintenance request");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}
let mounted: MaintenanceGate | undefined;
type LaneHealth = Readonly<{
  active: number;
  successAt: number | null;
  failed: boolean;
  failureRevision: number;
}>;
const emptyLane = (): LaneHealth => ({
  active: 0,
  successAt: null,
  failed: false,
  failureRevision: 0,
});
let laneHealth: Readonly<Record<string, LaneHealth>> = {};
let healthContext: string | null = null;
export function configureMaintenanceLanes(lanes: readonly string[]): void {
  if (!process.env.CRA_MAINTENANCE_DIRECTORY) return;
  for (const lane of lanes) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(lane))
      throw new Error("invalid maintenance lane identity");
    if (!laneHealth[lane]) laneHealth = { ...laneHealth, [lane]: emptyLane() };
  }
}
function synchronizeHealth(generation: string, imageId: string): void {
  const context = `${generation}:${imageId}`;
  if (context === healthContext) return;
  healthContext = context;
  laneHealth = Object.fromEntries(
    Object.entries(laneHealth).map(([lane, state]) => [
      lane,
      {
        ...state,
        successAt: null,
        failed: false,
        failureRevision: state.failureRevision + 1,
      },
    ]),
  );
}
function healthRequest(): Request {
  const directory = process.env.CRA_MAINTENANCE_DIRECTORY!;
  const request = requestSchema.parse(
    mountedRequest(join(directory, "request.json")),
  );
  synchronizeHealth(request.generation, process.env.CRA_IMAGE_ID ?? "unknown");
  return request;
}
function setLane(lane: string, state: LaneHealth): void {
  laneHealth = { ...laneHealth, [lane]: state };
}
function safePublishLive(): void {
  try {
    publishLive();
  } catch {
    /* Unavailable health evidence never proves readiness. */
  }
}
function oldestSuccessfulCycle(): number | null {
  const lanes = Object.values(laneHealth);
  if (
    !lanes.length ||
    lanes.some(
      (lane) => lane.active !== 0 || lane.failed || lane.successAt === null,
    )
  )
    return null;
  return Math.min(...lanes.map((lane) => lane.successAt!));
}
const candidatePermit = z.strictObject({
  version: z.literal(1),
  generation: z.uuid(),
  serviceIds: z.array(z.literal("api")).max(1),
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
function allowedCandidate(serviceId: "api", generation: string): boolean {
  try {
    const directory = process.env.CRA_MAINTENANCE_DIRECTORY;
    const imageId = process.env.CRA_IMAGE_ID;
    if (!directory || process.env.CRA_SERVICE_ID !== serviceId || !imageId)
      return false;
    const permit = candidatePermit.parse(
      mountedRequest(join(directory, "candidate-start.json")),
    );
    return (
      permit.generation === generation &&
      permit.serviceIds.includes(serviceId) &&
      permit.imageId === imageId
    );
  } catch {
    return false;
  }
}
function publishLive(): void {
  const directory = process.env.CRA_MAINTENANCE_DIRECTORY,
    ackDirectory = process.env.CRA_MAINTENANCE_ACK_DIRECTORY,
    imageId = process.env.CRA_IMAGE_ID,
    serviceId = process.env.CRA_SERVICE_ID;
  if (
    !directory ||
    !ackDirectory ||
    !imageId ||
    !/^sha256:[a-f0-9]{64}$/.test(imageId) ||
    !serviceId
  )
    return;
  const request = healthRequest();
  if (request.closed) return;
  const successfulCycleAt = oldestSuccessfulCycle();
  const target = join(ackDirectory, "live.json"),
    temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(
    temporary,
    JSON.stringify({
      version: 1,
      generation: request.generation,
      serviceId,
      pid: process.pid,
      imageId,
      claimsOpen: true,
      observedAt: new Date(successfulCycleAt ?? 0).toISOString(),
      dependenciesReady: successfulCycleAt !== null,
    }),
    { mode: 0o600, flush: true },
  );
  renameSync(temporary, target);
  const fd = openSync(
    ackDirectory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function mountedMaintenanceGate(): MaintenanceGate {
  if (mounted) return mounted;
  const directory = process.env.CRA_MAINTENANCE_DIRECTORY;
  const serviceId = process.env.CRA_SERVICE_ID ?? "unmanaged";
  const ackDirectory = process.env.CRA_MAINTENANCE_ACK_DIRECTORY;
  if (directory && !ackDirectory)
    throw new Error("maintenance requires a private acknowledgement directory");
  if (directory && serviceId === "unmanaged")
    throw new Error("maintenance requires a fixed service identity");
  mounted = new MaintenanceGate(
    serviceId,
    () =>
      directory
        ? requestSchema.parse(mountedRequest(join(directory, "request.json")))
        : null,
    (ack) => {
      if (!directory) return;
      const target = join(ackDirectory!, "ack.json");
      const temporary = `${target}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(ack), {
        mode: 0o600,
        flag: "w",
        flush: true,
      });
      renameSync(temporary, target);
      const dir = openSync(
        ackDirectory!,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    },
  );
  if (directory) {
    const timer = setInterval(() => {
      void mounted!
        .poll()
        .then(publishLive)
        .catch(() => {});
    }, 250);
    timer.unref();
  }
  return mounted;
}
export function maintenanceRun<T>(
  operation: () => Promise<T>,
  laneId = "source",
): Promise<T | undefined> {
  if (!process.env.CRA_MAINTENANCE_DIRECTORY) return operation();
  configureMaintenanceLanes([laneId]);
  return mountedMaintenanceGate().run(async () => {
    healthRequest();
    const admittedContext = healthContext;
    const initial = laneHealth[laneId]!;
    const revision = initial.failureRevision;
    setLane(laneId, {
      ...initial,
      active: initial.active + 1,
      successAt: null,
    });
    safePublishLive();
    try {
      const result = await operation();
      const completion = healthRequest(),
        current = laneHealth[laneId]!;
      const healthy =
        healthContext === admittedContext &&
        !completion.closed &&
        current.failureRevision === revision;
      setLane(laneId, {
        ...current,
        active: current.active - 1,
        successAt: healthy ? Date.now() : null,
        failed: healthy ? false : current.failed,
      });
      safePublishLive();
      return result;
    } catch (error) {
      const current = laneHealth[laneId]!;
      setLane(laneId, {
        ...current,
        active: current.active - 1,
        successAt: null,
        failed: true,
        failureRevision: current.failureRevision + 1,
      });
      safePublishLive();
      throw error;
    }
  });
}

/** Startup may write through framework hooks: acquire a lease before invoking it. */
export function maintenanceStart<T>(
  operation: () => Promise<T>,
  options?: Readonly<{ candidateServiceId: "api" }>,
): Promise<T> {
  if (!process.env.CRA_MAINTENANCE_DIRECTORY) return operation();
  return managedMaintenanceStart(operation, options);
}
async function managedMaintenanceStart<T>(
  operation: () => Promise<T>,
  options?: Readonly<{ candidateServiceId: "api" }>,
): Promise<T> {
  for (;;) {
    const gate = mountedMaintenanceGate();
    const leave = gate.enter(
      options
        ? (generation) =>
            allowedCandidate(options.candidateServiceId, generation)
        : undefined,
    );
    if (leave) {
      try {
        const result = await operation();
        if (options?.candidateServiceId === "api") {
          configureMaintenanceLanes(["bootstrap"]);
          healthRequest();
          setLane("bootstrap", { ...emptyLane(), successAt: Date.now() });
        }
        return result;
      } finally {
        leave();
      }
    }
    await gate.poll();
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
}
