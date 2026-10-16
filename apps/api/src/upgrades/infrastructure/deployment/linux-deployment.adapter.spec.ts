/* eslint-disable @typescript-eslint/require-await -- Controlled async test doubles do not access dynamic this. */
import {
  LinuxDeploymentAdapter,
  parseSemanticReadiness,
} from "./linux-deployment.adapter";
import type { LinuxDeploymentHost } from "./linux-deployment.adapter";
const image = {
  service: "api",
  digest: `sha256:${"b".repeat(64)}`,
  imageId: `sha256:${"b".repeat(64)}`,
  platform: "linux/amd64",
};
const images = [image, { ...image, service: "web" }];
function fixture() {
  const run = jest.fn(async (_exe: string, args: readonly string[]) =>
    args[0] === "image"
      ? JSON.stringify([
          {
            Id: image.imageId,
            RepoDigests: [`cra/api@${image.digest}`],
            Os: "linux",
            Architecture: "amd64",
          },
        ])
      : args.includes("config")
        ? JSON.stringify({
            services: {
              api: { image: image.imageId },
              web: { image: image.imageId },
              worker: { image: image.imageId },
            },
          })
        : "",
  );
  const host = {
    selectImages: jest.fn(async () => undefined),
    selectedImages: jest.fn(async () => images),
    verifyCandidate: jest.fn(async () => ({
      status: "healthy",
      version: "2",
      database: true,
      audit: true,
      licensing: true,
      contracts: true,
    })),
    verifyActivated: jest.fn(async () => ({
      status: "healthy",
      version: "2",
      workers: [
        {
          service: "worker",
          version: "2",
          claims: true,
          live: true,
          dependencies: true,
        },
      ],
    })),
  } as unknown as LinuxDeploymentHost;
  const config = {
    dockerExecutable: "/usr/bin/docker",
    composeFile: "/private/compose.yml",
    project: "cra",
    cwd: "/private",
    candidateServices: ["api", "web"],
    workerServices: ["worker"],
    serviceRoles: { api: "api", web: "web", worker: "api" } as const,
    imageVariables: { api: "CRA_API_IMAGE", web: "CRA_WEB_IMAGE" },
    environment: { PATH: "/usr/bin" },
    expectedVersion: "2",
  };
  return {
    adapter: new LinuxDeploymentAdapter(config, { run }, host),
    run,
    host,
  };
}
describe("Linux deployment fixed command adapter", () => {
  it("inspects loaded images then starts fixed services without pull or build", async () => {
    const f = fixture();
    await f.adapter.startCandidate(images);
    expect(f.run.mock.calls.at(-1)?.[1]).toEqual([
      "compose",
      "--project-name",
      "cra",
      "--file",
      "/private/compose.yml",
      "up",
      "--detach",
      "--no-deps",
      "--no-build",
      "--pull",
      "never",
      "api",
      "web",
    ]);
  });
  it("rejects arbitrary service and loaded image substitution", async () => {
    const f = fixture();
    await expect(
      f.adapter.startCandidate([{ ...image, service: "postgres" }]),
    ).rejects.toThrow();
    f.run.mockResolvedValue(
      JSON.stringify([
        { Id: "other", RepoDigests: [], Os: "linux", Architecture: "arm64" },
      ]),
    );
    await expect(f.adapter.startCandidate(images)).rejects.toThrow();
  });
  it("uses fixed workers and checks every worker revision", async () => {
    const f = fixture();
    await f.adapter.startWorkers();
    await f.adapter.verifyActivated();
    expect(f.run.mock.calls.at(-1)?.[1]).toContain("worker");
  });
  it("rejects HTTP200 degraded or incomplete semantic readiness", () => {
    for (const value of [
      { status: "degraded" },
      { status: "healthy" },
      {
        status: "healthy",
        version: "1",
        database: true,
        audit: true,
        licensing: true,
        contracts: true,
      },
    ]) {
      expect(() => parseSemanticReadiness(value, "2", [])).toThrow();
    }
  });
  it("accepts candidate semantics and rejects missing worker dependencies", async () => {
    const f = fixture();
    await f.adapter.verifyCandidate();
    expect(() =>
      parseSemanticReadiness(
        {
          status: "healthy",
          version: "2",
          workers: [
            {
              service: "worker",
              version: "2",
              claims: true,
              live: true,
              dependencies: false,
            },
          ],
        },
        "2",
        ["worker"],
      ),
    ).toThrow();
  });
});
describe("native runner and delegated lifecycle", () => {
  it("delegates real authority boundaries without manufacturing success", async () => {
    const f = fixture();
    const host = f.host as unknown as Record<string, jest.Mock>;
    for (const method of [
      "observe",
      "assertFresh",
      "closeIngress",
      "stopClaims",
      "drain",
      "holdVerifiedBackup",
      "migrate",
      "openIngress",
    ])
      host[method] = jest.fn(async () => undefined);
    await f.adapter.observe();
    await f.adapter.assertFresh("review");
    await f.adapter.closeIngress();
    await f.adapter.stopClaims();
    await f.adapter.drain();
    await f.adapter.holdVerifiedBackup();
    await f.adapter.openIngress();
    await f.adapter.migrate({
      runId: "x",
      fingerprint: "x",
      migrations: [],
      baselineLedger: [],
      expectedLedgerDigest: "target-ledger",
      targetSchemaDigest: "target-schema",
      candidateImages: images,
      previousImages: images,
      previousCompatibleAfterCandidateWrites: true,
    });
    await f.adapter.restorePreviousImages(images);
    expect(host.migrate).toHaveBeenCalled();
  });
  it("rejects invalid image identity and substituted Compose resolutions", async () => {
    const f = fixture();
    await expect(
      f.adapter.startCandidate(
        images.map((entry) => ({ ...entry, digest: "bad" })),
      ),
    ).rejects.toThrow("identity");
    f.run.mockImplementation(async (_exe, args) =>
      args[0] === "image"
        ? JSON.stringify([
            {
              Id: image.imageId,
              RepoDigests: [`cra/api@${image.digest}`],
              Os: "linux",
              Architecture: "amd64",
            },
          ])
        : JSON.stringify({ services: { api: { image: "wrong" } } }),
    );
    await expect(f.adapter.startCandidate(images)).rejects.toThrow(
      "compose_identity",
    );
  });
});
