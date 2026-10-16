/* eslint-disable @typescript-eslint/require-await */
import { MaintenanceGate } from "./maintenance-gate";
describe("maintenance drain", () => {
  it("closes claims before acknowledging and waits for active work", async () => {
    let closed = false;
    const acks: unknown[] = [];
    const gate = new MaintenanceGate(
      "worker",
      () => ({ generation: "generation", closed }),
      async (ack) => {
        acks.push(ack);
      },
    );
    let finish!: () => void;
    const active = gate.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    closed = true;
    await gate.poll();
    expect(acks).toHaveLength(0);
    expect(await gate.run(async () => "claimed")).toBeUndefined();
    finish();
    await active;
    expect(acks).toEqual([
      expect.objectContaining({
        generation: "generation",
        claimsClosed: true,
        drained: true,
      }),
    ]);
  });
  it("fails closed on unknown state and never acknowledges it", async () => {
    const ack = jest.fn();
    const gate = new MaintenanceGate(
      "worker",
      () => {
        throw new Error("unreadable");
      },
      ack,
    );
    expect(await gate.run(async () => "unsafe")).toBeUndefined();
    await gate.poll();
    expect(ack).not.toHaveBeenCalled();
  });
  it("keeps work accounting after failures and rejects invalid identity", async () => {
    expect(
      () =>
        new MaintenanceGate(
          "../bad",
          () => null,
          async () => {},
        ),
    ).toThrow();
    let closed = false;
    const ack = jest.fn();
    const gate = new MaintenanceGate(
      "api",
      () => ({ generation: "g", closed }),
      ack,
    );
    await expect(
      gate.run(async () => {
        throw new Error("source");
      }),
    ).rejects.toThrow("source");
    closed = true;
    await gate.poll();
    expect(ack).toHaveBeenCalledTimes(1);
  });
});

describe("mounted maintenance handshake", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    jest.useRealTimers();
    jest.resetModules();
  });
  it("keeps unconfigured development operation unchanged", async () => {
    delete process.env.CRA_MAINTENANCE_DIRECTORY;
    delete process.env.CRA_SERVICE_ID;
    const module =
      jest.requireActual<typeof import("./maintenance-gate")>(
        "./maintenance-gate",
      );
    expect(await module.maintenanceRun(async () => "ok")).toBe("ok");
    expect(module.mountedMaintenanceGate()).toBe(
      module.mountedMaintenanceGate(),
    );
  });
  it("rejects an unlabelled installed service", async () => {
    jest.resetModules();
    process.env.CRA_MAINTENANCE_DIRECTORY = "/missing";
    process.env.CRA_MAINTENANCE_ACK_DIRECTORY = "/missing-ack";
    delete process.env.CRA_SERVICE_ID;
    const module =
      jest.requireActual<typeof import("./maintenance-gate")>(
        "./maintenance-gate",
      );
    expect(() => module.mountedMaintenanceGate()).toThrow(
      "fixed service identity",
    );
  });
  it("acks only a known closed generation, deduplicates releases and pauses unknown state", async () => {
    jest.resetModules();
    jest.useFakeTimers();
    const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
    const os = jest.requireActual<typeof import("node:os")>("node:os");
    const path = jest.requireActual<typeof import("node:path")>("node:path");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cra-drain-"));
    try {
      process.env.CRA_MAINTENANCE_DIRECTORY = directory;
      process.env.CRA_MAINTENANCE_ACK_DIRECTORY = directory;
      process.env.CRA_SERVICE_ID = "test-worker";
      const module =
        jest.requireActual<typeof import("./maintenance-gate")>(
          "./maintenance-gate",
        );
      const gate = module.mountedMaintenanceGate();
      expect(await gate.run(async () => "unsafe")).toBeUndefined();
      const generation = "12345678-1234-4234-8234-123456789abc";
      fs.writeFileSync(
        path.join(directory, "request.json"),
        JSON.stringify({ version: 1, generation, closed: false }),
      );
      const release = gate.enter()!;
      release();
      release();
      fs.writeFileSync(
        path.join(directory, "request.json"),
        JSON.stringify({ version: 1, generation, closed: true }),
      );
      await gate.poll();
      await gate.poll();
      expect(
        JSON.parse(fs.readFileSync(path.join(directory, "ack.json"), "utf8")),
      ).toMatchObject({ generation, drained: true, claimsClosed: true });
      await jest.advanceTimersByTimeAsync(250);
      fs.writeFileSync(path.join(directory, "request.json"), "invalid");
      expect(await gate.run(async () => "unsafe")).toBeUndefined();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
it("defers restart initialization while closed and initializes once on reopen", async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
  const path = jest.requireActual<typeof import("node:path")>("node:path");
  const os = jest.requireActual<typeof import("node:os")>("node:os");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cra-start-gate-"));
  const original = { ...process.env };
  try {
    process.env.CRA_MAINTENANCE_DIRECTORY = directory;
    process.env.CRA_MAINTENANCE_ACK_DIRECTORY = directory;
    process.env.CRA_SERVICE_ID = "restart-worker";
    const generation = "12345678-1234-4234-8234-123456789abc";
    fs.writeFileSync(
      path.join(directory, "request.json"),
      JSON.stringify({ version: 1, generation, closed: true }),
    );
    const module =
      jest.requireActual<typeof import("./maintenance-gate")>(
        "./maintenance-gate",
      );
    const initialize = jest.fn().mockResolvedValue("initialized");
    const result = module.maintenanceStart(initialize);
    await jest.advanceTimersByTimeAsync(500);
    expect(initialize).not.toHaveBeenCalled();
    fs.writeFileSync(
      path.join(directory, "request.json"),
      JSON.stringify({ version: 1, generation, closed: false }),
    );
    await jest.advanceTimersByTimeAsync(250);
    expect(await result).toBe("initialized");
    expect(initialize).toHaveBeenCalledTimes(1);
  } finally {
    process.env = original;
    jest.useRealTimers();
    jest.resetModules();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
it("permits only the supervisor-selected candidate API and publishes live proof after startup", async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
  const path = jest.requireActual<typeof import("node:path")>("node:path");
  const os = jest.requireActual<typeof import("node:os")>("node:os");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cra-candidate-gate-"),
  );
  const original = { ...process.env };
  try {
    const generation = "12345678-1234-4234-8234-123456789abc",
      imageId = `sha256:${"a".repeat(64)}`;
    Object.assign(process.env, {
      CRA_MAINTENANCE_DIRECTORY: directory,
      CRA_MAINTENANCE_ACK_DIRECTORY: directory,
      CRA_SERVICE_ID: "api",
      CRA_IMAGE_ID: imageId,
    });
    fs.writeFileSync(
      path.join(directory, "request.json"),
      JSON.stringify({ version: 1, generation, closed: true }),
    );
    const module =
      jest.requireActual<typeof import("./maintenance-gate")>(
        "./maintenance-gate",
      );
    const initialize = jest.fn().mockResolvedValue("candidate");
    const result = module.maintenanceStart(initialize, {
      candidateServiceId: "api",
    });
    await jest.advanceTimersByTimeAsync(250);
    expect(initialize).not.toHaveBeenCalled();
    fs.writeFileSync(
      path.join(directory, "candidate-start.json"),
      JSON.stringify({
        version: 1,
        generation,
        serviceIds: ["api"],
        imageId: `sha256:${"b".repeat(64)}`,
      }),
    );
    await jest.advanceTimersByTimeAsync(250);
    expect(initialize).not.toHaveBeenCalled();
    fs.writeFileSync(
      path.join(directory, "candidate-start.json"),
      JSON.stringify({ version: 1, generation, serviceIds: ["api"], imageId }),
    );
    await jest.advanceTimersByTimeAsync(250);
    expect(await result).toBe("candidate");
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(directory, "live.json"))).toBe(false);
    fs.writeFileSync(
      path.join(directory, "request.json"),
      JSON.stringify({ version: 1, generation, closed: false }),
    );
    await jest.advanceTimersByTimeAsync(250);
    expect(
      JSON.parse(fs.readFileSync(path.join(directory, "live.json"), "utf8")),
    ).toMatchObject({
      generation,
      imageId,
      claimsOpen: true,
      serviceId: "api",
    });
  } finally {
    process.env = original;
    jest.useRealTimers();
    jest.resetModules();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
it("bootstrap alone cannot prove dependencies and failed or hung cycles cannot renew healthy proof", async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs"),
    path = jest.requireActual<typeof import("node:path")>("node:path"),
    os = jest.requireActual<typeof import("node:os")>("node:os");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cra-health-cycle-"));
  const original = { ...process.env };
  try {
    const generation = "12345678-1234-4234-8234-123456789abc";
    Object.assign(process.env, {
      CRA_MAINTENANCE_DIRECTORY: directory,
      CRA_MAINTENANCE_ACK_DIRECTORY: directory,
      CRA_SERVICE_ID: "worker",
      CRA_IMAGE_ID: `sha256:${"a".repeat(64)}`,
    });
    fs.writeFileSync(
      path.join(directory, "request.json"),
      JSON.stringify({ version: 1, generation, closed: false }),
    );
    const module =
      jest.requireActual<typeof import("./maintenance-gate")>(
        "./maintenance-gate",
      );
    const live = () =>
      JSON.parse(
        fs.readFileSync(path.join(directory, "live.json"), "utf8"),
      ) as { dependenciesReady: boolean; observedAt: string };
    await module.maintenanceStart(async () => "context");
    await jest.advanceTimersByTimeAsync(250);
    expect(live().dependenciesReady).toBe(false);
    await module.maintenanceRun(async () => "healthy");
    expect(live().dependenciesReady).toBe(true);
    const observedAt = live().observedAt;
    await jest.advanceTimersByTimeAsync(1000);
    expect(live().observedAt).toBe(observedAt);
    let finish!: (value: string) => void;
    const active = module.maintenanceRun(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    expect(live().dependenciesReady).toBe(false);
    await jest.advanceTimersByTimeAsync(10000);
    expect(live().dependenciesReady).toBe(false);
    finish("completed");
    await active;
    await expect(
      module.maintenanceRun(async () => {
        throw new Error("dependency");
      }),
    ).rejects.toThrow("dependency");
    expect(live().dependenciesReady).toBe(false);
  } finally {
    process.env = original;
    jest.useRealTimers();
    jest.resetModules();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
it("returns the original effect promise synchronously when maintenance is unconfigured", () => {
  const original = { ...process.env };
  delete process.env.CRA_MAINTENANCE_DIRECTORY;
  try {
    const module =
      jest.requireActual<typeof import("./maintenance-gate")>(
        "./maintenance-gate",
      );
    const pending = Promise.resolve("same promise");
    const effect = jest.fn(() => pending);
    expect(module.maintenanceStart(effect)).toBe(pending);
    expect(module.maintenanceRun(effect)).toBe(pending);
    expect(effect).toHaveBeenCalledTimes(2);
  } finally {
    process.env = original;
  }
});
it("keeps concurrent hung and failed notification lanes unhealthy despite peer successes", async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs"),
    path = jest.requireActual<typeof import("node:path")>("node:path"),
    os = jest.requireActual<typeof import("node:os")>("node:os");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cra-concurrent-lanes-"),
  );
  const original = { ...process.env };
  try {
    const generation = "12345678-1234-4234-8234-123456789abc";
    Object.assign(process.env, {
      CRA_MAINTENANCE_DIRECTORY: directory,
      CRA_MAINTENANCE_ACK_DIRECTORY: directory,
      CRA_SERVICE_ID: "notification-dispatch-worker",
      CRA_IMAGE_ID: `sha256:${"a".repeat(64)}`,
    });
    fs.writeFileSync(
      path.join(directory, "request.json"),
      JSON.stringify({ version: 1, generation, closed: false }),
    );
    const module =
      jest.requireActual<typeof import("./maintenance-gate")>(
        "./maintenance-gate",
      );
    const run = module.maintenanceRun;
    const live = () =>
      JSON.parse(
        fs.readFileSync(path.join(directory, "live.json"), "utf8"),
      ) as { dependenciesReady: boolean; observedAt: string };
    let finish!: () => void;
    const hung = run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      "dispatch",
    );
    await run(async () => "peer healthy", "digest");
    expect(live().dependenciesReady).toBe(false);
    finish();
    await hung;
    expect(live().dependenciesReady).toBe(true);
    await expect(
      run(async () => {
        throw new Error("dispatch failed");
      }, "dispatch"),
    ).rejects.toThrow("dispatch failed");
    await run(async () => "peer still healthy", "digest");
    expect(live().dependenciesReady).toBe(false);
  } finally {
    process.env = original;
    jest.useRealTimers();
    jest.resetModules();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
it("requires every configured lane in the current generation and preserves the oldest success", async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs"),
    path = jest.requireActual<typeof import("node:path")>("node:path"),
    os = jest.requireActual<typeof import("node:os")>("node:os");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cra-lane-generation-"),
  );
  const original = { ...process.env };
  try {
    let generation = "12345678-1234-4234-8234-123456789abc";
    Object.assign(process.env, {
      CRA_MAINTENANCE_DIRECTORY: directory,
      CRA_MAINTENANCE_ACK_DIRECTORY: directory,
      CRA_SERVICE_ID: "notification-dispatch-worker",
      CRA_IMAGE_ID: `sha256:${"a".repeat(64)}`,
    });
    const request = () =>
      fs.writeFileSync(
        path.join(directory, "request.json"),
        JSON.stringify({ version: 1, generation, closed: false }),
      );
    request();
    const module =
      jest.requireActual<typeof import("./maintenance-gate")>(
        "./maintenance-gate",
      );
    const live = () =>
      JSON.parse(
        fs.readFileSync(path.join(directory, "live.json"), "utf8"),
      ) as { dependenciesReady: boolean; observedAt: string };
    module.configureMaintenanceLanes(["dispatch", "digest"]);
    expect(() => module.configureMaintenanceLanes(["../other"])).toThrow(
      "lane identity",
    );
    await module.maintenanceRun(async () => "dispatch", "dispatch");
    expect(live().dependenciesReady).toBe(false);
    const oldest = new Date().toISOString();
    await jest.advanceTimersByTimeAsync(1000);
    await module.maintenanceRun(async () => "digest", "digest");
    expect(live()).toMatchObject({
      dependenciesReady: true,
      observedAt: oldest,
    });
    generation = "12345678-1234-4234-8234-123456789abd";
    request();
    await jest.advanceTimersByTimeAsync(250);
    expect(live().dependenciesReady).toBe(false);
    await module.maintenanceRun(async () => "digest new generation", "digest");
    expect(live().dependenciesReady).toBe(false);
    await module.maintenanceRun(
      async () => "dispatch new generation",
      "dispatch",
    );
    expect(live().dependenciesReady).toBe(true);
    let finish!: () => void;
    const old = module.maintenanceRun(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      "dispatch",
    );
    process.env.CRA_IMAGE_ID = `sha256:${"b".repeat(64)}`;
    await jest.advanceTimersByTimeAsync(250);
    finish();
    await old;
    expect(live().dependenciesReady).toBe(false);
  } finally {
    process.env = original;
    jest.useRealTimers();
    jest.resetModules();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
it("does not let an overlapping same-lane success erase its peer failure", async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const fs = jest.requireActual<typeof import("node:fs")>("node:fs"),
    path = jest.requireActual<typeof import("node:path")>("node:path"),
    os = jest.requireActual<typeof import("node:os")>("node:os");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cra-same-lane-"));
  const original = { ...process.env };
  try {
    Object.assign(process.env, {
      CRA_MAINTENANCE_DIRECTORY: directory,
      CRA_MAINTENANCE_ACK_DIRECTORY: directory,
      CRA_SERVICE_ID: "worker",
      CRA_IMAGE_ID: `sha256:${"a".repeat(64)}`,
    });
    fs.writeFileSync(
      path.join(directory, "request.json"),
      JSON.stringify({
        version: 1,
        generation: "12345678-1234-4234-8234-123456789abc",
        closed: false,
      }),
    );
    const module =
      jest.requireActual<typeof import("./maintenance-gate")>(
        "./maintenance-gate",
      );
    let finish!: () => void;
    const overlap = module.maintenanceRun(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await expect(
      module.maintenanceRun(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    finish();
    await overlap;
    expect(
      JSON.parse(fs.readFileSync(path.join(directory, "live.json"), "utf8")),
    ).toMatchObject({ dependenciesReady: false });
    await module.maintenanceRun(async () => "actual retry");
    expect(
      JSON.parse(fs.readFileSync(path.join(directory, "live.json"), "utf8")),
    ).toMatchObject({ dependenciesReady: true });
  } finally {
    process.env = original;
    jest.useRealTimers();
    jest.resetModules();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
