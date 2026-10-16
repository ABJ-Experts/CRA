import type { Request } from "express";
import { AgentIngressController } from "./agent-ingress.controller";
import type { AgentIngressUseCases } from "./agent-ingress.use-cases";

describe("AgentIngressController", () => {
  it("passes parsed enrollment and signed frame inputs to the isolated use cases", async () => {
    const useCases = {
      enroll: jest.fn().mockResolvedValue({ agentId: "agent" }),
      acceptFrame: jest.fn().mockResolvedValue({ kind: "heartbeat" }),
    };
    const controller = new AgentIngressController(
      useCases as unknown as AgentIngressUseCases,
    );
    const enrollment = { token: "t".repeat(32), csrPem: "csr" };
    const frame = {
      version: 1 as const,
      kind: "heartbeat" as const,
      organizationId: "org",
      connectorId: "connector",
      agentId: "agent",
      agentVersion: "1.0.0",
      capabilities: ["canonical_file" as const],
      backlogCount: 0,
      backlogBytes: 0,
      safeErrorCode: null,
    };
    const request = {
      rawBody: Buffer.from(JSON.stringify(frame)),
    } as Request & { rawBody: Buffer };
    expect(await controller.enroll(enrollment)).toEqual({ agentId: "agent" });
    expect(await controller.frames(request, frame)).toEqual({
      kind: "heartbeat",
    });
    expect(useCases.enroll).toHaveBeenCalledWith(enrollment);
    expect(useCases.acceptFrame).toHaveBeenCalledWith(request, frame);
  });
});
