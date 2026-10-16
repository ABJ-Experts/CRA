import { SetMetadata } from "@nestjs/common";
export const OPERATOR_SCOPED_KEY = Symbol("operator-scoped");
/** Only the separate private composition root understands this realm marker. */
export const OperatorScoped = (reason: string): ClassDecorator =>
  SetMetadata(OPERATOR_SCOPED_KEY, reason);
