export class LicenseVerificationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "LicenseVerificationError";
  }
}
