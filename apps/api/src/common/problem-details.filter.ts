import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { getContext } from './tenant-context';

// Central RFC 9457 (Problem Details) mapper. Typed domain errors are duck-typed
// by name so this cross-cutting filter needn't import a domain module. SEC-015:
// never leak stack traces / internals to the client.
type DomainErrorCode =
  'not_found' | 'validation' | 'invalid_transition' | 'conflict';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  not_found: HttpStatus.NOT_FOUND,
  validation: HttpStatus.BAD_REQUEST,
  invalid_transition: HttpStatus.CONFLICT,
  conflict: HttpStatus.CONFLICT,
};

function asDomainError(
  e: unknown,
): { code: DomainErrorCode; message: string } | null {
  if (!(e instanceof Error) || e.name !== 'DomainError') return null;
  const code = (e as Error & { code?: unknown }).code;
  if (typeof code === 'string' && code in STATUS_BY_CODE) {
    return { code: code as DomainErrorCode, message: e.message };
  }
  return null;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const correlationId = getContext()?.correlationId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let type = 'about:blank';
    let title = 'Internal Server Error';
    let detail: string | undefined;

    const domain = asDomainError(exception);
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      title = exception.name.replace(/Exception$/, '');
      if (typeof resp === 'string') {
        detail = resp;
      } else {
        const m = (resp as { message?: unknown }).message;
        detail = Array.isArray(m)
          ? m.join('; ')
          : typeof m === 'string'
            ? m
            : exception.message;
      }
    } else if (domain) {
      status = STATUS_BY_CODE[domain.code];
      type = `https://cra-sentinel.dev/problems/${domain.code}`;
      title = domain.code;
      detail = domain.message;
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type, title, status, detail, correlationId });
  }
}
