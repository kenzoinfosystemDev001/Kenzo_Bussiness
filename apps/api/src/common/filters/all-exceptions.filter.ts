import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody, ErrorCode } from '@kenzo/shared';
import type { Response } from 'express';
import { AppError } from '../errors/app-error';
import { RequestContext } from '../context/request-context';

/**
 * Renders every error as the standard envelope `{ error: { code, message,
 * fieldErrors?, correlationId } }`. Stack traces and internal messages are never
 * returned to clients; unexpected errors are logged with the correlation ID.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const correlationId = RequestContext.correlationId() ?? 'unknown';
    const { status, body } = this.toResponse(exception, correlationId);
    if (status >= 500) {
      this.logger.error(
        JSON.stringify({ msg: 'unhandled_error', correlationId, error: exception instanceof Error ? exception.message : String(exception) }),
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    if (!res.headersSent) res.status(status).json(body);
  }

  private toResponse(exception: unknown, correlationId: string): { status: number; body: ApiErrorBody } {
    const envelope = (code: ErrorCode, message: string, extra: Partial<ApiErrorBody['error']> = {}): ApiErrorBody => ({
      error: { code, message, correlationId, ...extra },
    });

    if (exception instanceof AppError) {
      return {
        status: exception.status,
        body: envelope(exception.code, exception.message, {
          ...(exception.options.fieldErrors ? { fieldErrors: exception.options.fieldErrors } : {}),
          ...(exception.options.details ? { details: exception.options.details } : {}),
        }),
      };
    }

    if (exception instanceof ThrottlerException) {
      return { status: 429, body: envelope('RATE_LIMITED', 'Too many requests. Please wait and try again.') };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { status: 409, body: envelope('CONFLICT', 'A record with these unique values already exists') };
        case 'P2025':
          return { status: 404, body: envelope('NOT_FOUND', 'Record not found') };
        case 'P2003':
          return { status: 409, body: envelope('CONFLICT', 'A referenced record does not exist or is still in use') };
        default:
          break;
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const map: Record<number, ErrorCode> = {
        [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
        [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
        [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
        [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
        [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
        [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
        [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
      };
      const code = map[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED');
      const message = status === 404 ? 'Route not found' : status >= 500 ? 'Unexpected server error' : exception.message;
      return { status, body: envelope(code, message) };
    }

    return {
      status: 500,
      body: envelope('INTERNAL_ERROR', 'An unexpected error occurred. Quote the correlation ID when reporting it.'),
    };
  }
}
