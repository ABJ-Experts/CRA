import { Body, Controller, Post, Req } from "@nestjs/common";
import * as schemas from "@repo/contracts/connectors/schemas";
import type { z } from "zod";
import type { Request } from "express";
import { Throttle } from "@nestjs/throttler";
import { ZodResponse } from "../../common/http/zod-response.interceptor";
import { zodBody } from "../../common/pipes/zod-validation.pipe";
import { Public } from "../../auth/auth.types";
import { AgentIngressUseCases } from "./agent-ingress.use-cases";

@Controller("agent")
export class AgentIngressController {
  constructor(private readonly useCases: AgentIngressUseCases) {}
  @Post("enroll")
  @Public() // One-time scoped enrollment token is the credential; no browser session.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ZodResponse(schemas.agentEnrollResponseSchema)
  enroll(
    @Body(zodBody(schemas.agentEnrollInputSchema))
    body: z.output<typeof schemas.agentEnrollInputSchema>,
  ) {
    return this.useCases.enroll(body);
  }
  @Post("frames")
  @Public() // Dedicated TLS listener requires the bound client cert and signed frame.
  @ZodResponse(schemas.agentFrameResponseSchema)
  frames(
    @Req() request: Request & { rawBody?: Buffer },
    @Body(zodBody(schemas.agentFrameBodySchema))
    frame: z.output<typeof schemas.agentFrameBodySchema>,
  ) {
    return this.useCases.acceptFrame(request, frame);
  }
}
