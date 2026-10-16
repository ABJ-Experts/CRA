import type { Request } from "express";
import type { OperatorIdentity } from "./domain/operator-grants";
/** Set exclusively by the private raw-TLS middleware before presentation. */
export type OperatorRequest = Request & { operatorIdentity: OperatorIdentity };
