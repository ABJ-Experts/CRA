import type { z } from "zod";
import type {
  agentEnrollInputSchema,
  agentEnrollResponseSchema,
  agentFrameBodySchema,
  agentFrameResponseSchema,
  agentStatusResponseSchema,
  issueAgentEnrollmentInputSchema,
  issueAgentEnrollmentResponseSchema,
  revokeAgentInputSchema,
  revokeAgentResponseSchema,
} from "../schemas/agent.schema.js";

export type AgentEnrollInput = z.output<typeof agentEnrollInputSchema>;
export type AgentEnrollResponse = z.output<typeof agentEnrollResponseSchema>;
export type AgentFrameBody = z.output<typeof agentFrameBodySchema>;
export type AgentFrameResponse = z.output<typeof agentFrameResponseSchema>;
export type AgentStatusResponse = z.output<typeof agentStatusResponseSchema>;
export type IssueAgentEnrollmentInput = z.output<typeof issueAgentEnrollmentInputSchema>;
export type IssueAgentEnrollmentResponse = z.output<typeof issueAgentEnrollmentResponseSchema>;
export type RevokeAgentInput = z.output<typeof revokeAgentInputSchema>;
export type RevokeAgentResponse = z.output<typeof revokeAgentResponseSchema>;
