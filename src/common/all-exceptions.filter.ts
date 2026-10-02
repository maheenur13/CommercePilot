import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { Prisma } from '../generated/prisma/client.js';
import type { ErrorDetailDto } from './http/envelope.js';

interface ErrorBody {
  code: string;
  message: string;
  details?: ErrorDetailDto[];
  requestId?: string;
}

/**
 * Single error envelope for every failure: `{ success: false, error: { code, message, details?, requestId } }`.
 * Services may throw `new XxxException({ code, message })` to set a domain-specific code;
 * otherwise the code is derived from the HTTP status. Internals never leak to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    const [status, error] = this.toError(exception);
    error.requestId = req.id;
    if (status >= 500) this.logger.error(exception);

    res.status(status).json({ success: false, error });
  }

  private toError(exception: unknown): [number, ErrorBody] {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const obj =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const message = Array.isArray(obj.message)
        ? obj.message.join('; ')
        : typeof obj.message === 'string'
          ? obj.message
          : exception.message;
      return [
        status,
        {
          code: typeof obj.code === 'string' ? obj.code : codeFor(status),
          message,
          ...(Array.isArray(obj.details) && { details: obj.details as ErrorDetailDto[] }),
        },
      ];
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return [409, { code: 'ALREADY_EXISTS', message: 'Resource already exists' }];
      }
      if (exception.code === 'P2025') {
        return [404, { code: 'NOT_FOUND', message: 'Resource not found' }];
      }
    }
    // Middleware errors (e.g. body-parser's 413 payload too large) carry a 4xx `status`.
    const status = (exception as { status?: unknown } | null)?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message = exception instanceof Error ? exception.message : 'Bad request';
      return [status, { code: codeFor(status), message }];
    }
    return [500, { code: 'INTERNAL_ERROR', message: 'Internal server error' }];
  }
}

function codeFor(status: number): string {
  return HttpStatus[status] ?? 'ERROR';
}
