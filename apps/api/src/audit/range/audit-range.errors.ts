export class AuditRangeForbiddenError extends Error {}
export class AuditRangeNotFoundError extends Error {}
export class AuditRangeConflictError extends Error {}
export class AuditRangeUnavailableError extends Error {}
export class AuditRangeInputError extends Error {}
export class AuditRangeLimitError extends Error {
  constructor(readonly code: "byte_limit" | "event_limit") {
    super(code);
  }
}
