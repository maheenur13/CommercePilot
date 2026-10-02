import {
  BadRequestException,
  type INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { join } from 'node:path';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ValidationError } from 'class-validator';
import helmet from 'helmet';

import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import type { ErrorDetailDto } from './common/http/envelope.js';
import { ResponseEnvelopeInterceptor } from './common/http/envelope.js';

export const API_PREFIX = 'api/v1';

/** Flattens nested class-validator errors into `{ field: 'items.0.quantity', messages }`. */
function flatten(errors: ValidationError[], parent = ''): ErrorDetailDto[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, messages: Object.values(e.constraints) }] : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/** Shared by main.ts and e2e tests so tests exercise the exact production pipeline. */
export function configureApp(app: INestApplication): void {
  app.use(helmet());
  // Demo chat page at /chat (public/chat.html). Its script is a separate file, so helmet's
  // default CSP (script-src 'self') applies unchanged.
  (app as NestExpressApplication).useStaticAssets(join(process.cwd(), 'public'), {
    extensions: ['html'],
    index: false,
  });
  // Business routes are versioned; infrastructure endpoints stay at the root.
  app.setGlobalPrefix(API_PREFIX, { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: flatten(errors),
        }),
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
