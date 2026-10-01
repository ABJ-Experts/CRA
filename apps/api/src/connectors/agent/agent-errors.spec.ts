import { HttpException } from "@nestjs/common";
import { agentHttpError } from "./agent-errors";
import { AgentRepositoryError } from "./supabase-agent.repository";

describe("agent error boundary", () => {
  it.each([
    ["not_found", 404],
    ["invalid_enrollment", 410],
    ["invalid_token", 410],
    ["expired", 410],
    ["token_expired", 410],
    ["token_consumed", 410],
    ["forbidden", 403],
    ["forbidden_by_policy", 403],
    ["invalid_request", 400],
    ["revoked", 401],
    ["identity_mismatch", 401],
    ["key_expired", 401],
    ["replacement_requires_new_connector", 409],
    ["conflict", 409],
    ["identity_revoked", 409],
    ["replay", 409],
    ["sequence_gap", 409],
    ["sequence_conflict", 409],
    ["rotation_in_progress", 409],
    ["idempotency_mismatch", 409],
    ["idempotency_conflict", 409],
    ["invalid_state", 409],
    ["backpressure", 429],
    ["unavailable", 503],
  ])("maps %s to a safe HTTP %i response", (code, status) => {
    const mapped = agentHttpError(new AgentRepositoryError(code));
    expect(mapped).toBeInstanceOf(HttpException);
    const response = mapped as HttpException;
    expect(response.getStatus()).toBe(status);
    const body = response.getResponse() as { code: string; message: string };
    expect(body.code).toBe(code === "unavailable" ? "unavailable" : code);
    expect(body.message).not.toContain("Agent operation failed");
  });

  it("preserves existing errors and hides unknown thrown values", () => {
    const original = new Error("known internal failure");
    expect(agentHttpError(original)).toBe(original);
    const mapped = agentHttpError("raw secret") as HttpException;
    expect(mapped.getStatus()).toBe(503);
    expect(JSON.stringify(mapped.getResponse())).not.toContain("raw secret");
  });
});
