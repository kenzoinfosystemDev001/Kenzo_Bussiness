import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

const CORRELATION_RE = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Establishes the per-request context: correlation ID (accepted from a trusted
 * upstream header if well-formed, otherwise generated), client IP and user agent.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-correlation-id');
    const correlationId = incoming && CORRELATION_RE.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-correlation-id', correlationId);
    RequestContext.run(
      {
        correlationId,
        ipAddress: (req.ip ?? req.socket.remoteAddress ?? null)?.slice(0, 64) ?? null,
        userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
      },
      () => next(),
    );
  }
}
