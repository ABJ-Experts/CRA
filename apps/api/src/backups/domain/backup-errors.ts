export class BackupAuthorizationError extends Error {
  constructor() {
    super("Backup assurance unavailable");
    this.name = "BackupAuthorizationError";
  }
}
export class BackupScopeError extends Error {
  constructor() {
    super("Backup scope unavailable");
    this.name = "BackupScopeError";
  }
}
export class BackupUnavailableError extends Error {
  constructor() {
    super("Backup assurance unavailable");
    this.name = "BackupUnavailableError";
  }
}
export class BackupOriginError extends Error {
  constructor() {
    super("Private JSON origin required");
    this.name = "BackupOriginError";
  }
}
