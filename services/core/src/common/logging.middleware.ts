import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    // TODO: redact sensitive fields (passwords, tokens, auth headers) before logging
    const { method, originalUrl, params, query, body } = req;
    const start = Date.now();

    this.logger.log(
      `→ ${method} ${originalUrl} params=${safeStringify(params)} query=${safeStringify(query)} body=${safeStringify(body)}`,
    );

    let responseBody: unknown;
    const originalSend = res.send.bind(res);
    res.send = (chunk: unknown) => {
      responseBody = chunk;
      return originalSend(chunk);
    };

    res.on('finish', () => {
      const elapsed = Date.now() - start;
      this.logger.log(
        `← ${method} ${originalUrl} ${res.statusCode} (${elapsed}ms) body=${safeStringify(responseBody)}`,
      );
    });

    next();
  }
}

function safeStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length}b>`;
  try {
    return JSON.stringify(value);
  } catch {
    return '<unserializable>';
  }
}
