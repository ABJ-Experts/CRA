export class SiemForbiddenError extends Error {
  constructor() {
    super("SIEM access denied");
  }
}
export class SiemUnavailableError extends Error {
  constructor() {
    super("SIEM unavailable");
  }
}
export class SiemConflictError extends Error {
  constructor() {
    super("SIEM operation conflicts");
  }
}
export class SiemNotFoundError extends Error {
  constructor() {
    super("SIEM destination not found");
  }
}
export class SiemInputError extends Error {
  constructor() {
    super("Invalid SIEM request");
  }
}
