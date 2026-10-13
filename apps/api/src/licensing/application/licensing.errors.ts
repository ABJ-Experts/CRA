/** Safe domain/application failure; HTTP mapping belongs to the presentation boundary. */
export class LicensingError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "LicensingError";
  }
}
