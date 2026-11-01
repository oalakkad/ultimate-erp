import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX, AUTH_STATE_HEADER, REQUEST_ID_HEADER } from '@ultimate-erp/contracts';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { type AppConfig, webPublicUrl } from './platform/config/config.js';
import { PROXY_HOPS_SETTING } from './platform/request-context/client-ip.js';
import { headerSessionMiddleware } from './platform/request-context/header-session.middleware.js';
import { originCheckMiddleware } from './platform/request-context/origin-check.middleware.js';
import { jsonBodyMiddleware } from './platform/request-context/json-body.middleware.js';
import { requestIdMiddleware } from './platform/request-context/request-id.middleware.js';
import { slowRequestMiddleware } from './platform/request-context/slow-request.middleware.js';

/** Builds the HTTP application. Shared by `main.ts` and the integration tests. */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
    // Registered below with an explicit size limit, after the request ID middleware.
    bodyParser: false,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  // Only the client IP follows trusted proxies (client-ip.ts); the company is always the Host.
  app.set(PROXY_HOPS_SETTING, config.TRUST_PROXY_HOPS);

  // Order matters: request ID first so every later step (incl. errors) can reference it.
  app.use(requestIdMiddleware(config.TRUST_INCOMING_REQUEST_ID));
  app.use(
    slowRequestMiddleware(config.SLOW_REQUEST_MS, (entry) => {
      logger.warn({ ...entry }, 'Slow request');
    }),
  );
  // API responses are JSON only: forbid all content sources and any framing.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );
  // Mobile app: auth state in a header instead of cookies (before the Origin check, which
  // does not apply to such requests — they carry no ambient browser credential).
  app.use(headerSessionMiddleware());
  app.use(
    originCheckMiddleware([config.APP_PUBLIC_URL, webPublicUrl(config), ...config.CORS_ORIGINS]),
  );
  app.use(jsonBodyMiddleware(config.HTTP_BODY_LIMIT));

  if (config.CORS_ORIGINS.length > 0) {
    app.enableCors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: [REQUEST_ID_HEADER, AUTH_STATE_HEADER],
    });
  }

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
