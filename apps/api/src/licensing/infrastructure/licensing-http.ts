import { HttpException } from "@nestjs/common";
import { LicensingError } from "../application/licensing.errors";
export function licensingHttpException(error: LicensingError): HttpException {
  return new HttpException(
    {
      code: error.code,
      message: error.message,
      ...(error.reason ? { details: { reason: error.reason } } : {}),
    },
    error.status,
  );
}
export async function licensingHttp<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LicensingError) throw licensingHttpException(error);
    throw error;
  }
}
