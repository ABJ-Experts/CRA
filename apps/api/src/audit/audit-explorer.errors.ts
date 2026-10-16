export class AuditExplorerNotFoundError extends Error {
  constructor(message = "audit explorer target not found") {
    super(message);
    this.name = "AuditExplorerNotFoundError";
  }
}

export class AuditExplorerStaleError extends Error {
  constructor(message = "audit explorer snapshot is stale") {
    super(message);
    this.name = "AuditExplorerStaleError";
  }
}

export class AuditExplorerConflictError extends Error {
  constructor(message = "audit explorer request conflict") {
    super(message);
    this.name = "AuditExplorerConflictError";
  }
}

export class AuditExplorerUnavailableError extends Error {
  constructor(message = "audit explorer provider unavailable") {
    super(message);
    this.name = "AuditExplorerUnavailableError";
  }
}

export class AuditExplorerForbiddenError extends Error {
  constructor(message = "audit explorer access denied") {
    super(message);
    this.name = "AuditExplorerForbiddenError";
  }
}
