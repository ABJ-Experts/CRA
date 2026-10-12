export class ExportAccessDeniedError extends Error {
  constructor() {
    super("Export is not available");
  }
}
export class ExportConflictError extends Error {
  constructor() {
    super("Export state changed");
  }
}
export class ExportUnavailableError extends Error {
  constructor() {
    super("Export service is unavailable");
  }
}
export class ExportInvalidRequestError extends Error {
  constructor() {
    super("Export request is invalid");
  }
}
