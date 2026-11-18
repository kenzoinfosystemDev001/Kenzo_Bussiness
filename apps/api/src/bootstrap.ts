import 'reflect-metadata';
import { type INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadEnv } from './config/env';
import { AppModule } from './app.module';

/**
 * Builds the HTTP application. Shared by `main.ts` and the integration tests so
 * tests exercise exactly the production middleware, guards and filters.
 */
export async function createApp(options: { logger?: boolean } = {}): Promise<INestApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: options.logger === false ? false : env.LOG_LEVEL === 'debug' ? ['log', 'warn', 'error', 'debug'] : ['log', 'warn', 'error'],
    bodyParser: false,
  });

  app.setGlobalPrefix('api/v1', { exclude: [] });
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Secure headers. The API serves JSON only, so the CSP forbids everything.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '100kb' });

  // The web app reaches the API through a same-origin proxy, so CORS is only
  // needed for direct cross-origin development access to APP_ORIGIN.
  app.enableCors({ origin: env.ALLOWED_ORIGINS, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  app.enableShutdownHooks();
  return app;
}

export async function startServer(): Promise<void> {
  const env = loadEnv();
  const app = await createApp();
  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`Kenzo-Kore API listening on :${env.PORT} (${env.NODE_ENV})`);
}
