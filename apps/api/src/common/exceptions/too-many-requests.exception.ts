import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * 429. Nest ships no built-in class for this status, and lockout / OTP-attempt
 * exhaustion both need it — a 401 would be wrong (the credentials may well be
 * correct) and a 400 loses the retry semantics the client should respect.
 */
export class TooManyRequestsException extends HttpException {
  constructor(response: { message: string; code?: string }) {
    super(response, HttpStatus.TOO_MANY_REQUESTS);
  }
}
