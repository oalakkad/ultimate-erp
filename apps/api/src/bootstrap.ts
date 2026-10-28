import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX, REQUEST_ID_HEADER } from '@ultimate-erp/contracts';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { type AppConfig, webPublicUrl } from './platform/config/config.js';
import { originCheckMiddleware } from './platform/request-context/origin-check.middleware.js';
import { jsonBodyMiddleware } from './platform/request-context/json-body.middleware.js';
import { requestIdMiddleware } from './platform/request-context/request-id.middleware.js';

/** Builds the HTTP application. Shared by `main.ts` and the integration tests. */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
    // Registered below with an explicit size limit, after the request ID middleware.
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  // Order matters: request ID first so every later step (incl. errors) can reference it.
  app.use(requestIdMiddleware(config.TRUST_INCOMING_REQUEST_ID));
  // API responses are JSON only: forbid all content sources and any framing.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
    }),
  );
  app.use(
    originCheckMiddleware([config.APP_PUBLIC_URL, webPublicUrl(config), ...config.CORS_ORIGINS]),
  );
  app.use(jsonBodyMiddleware(config.HTTP_BODY_LIMIT));

  if (config.CORS_ORIGINS.length > 0) {
    app.enableCors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: [REQUEST_ID_HEADER],
    });
  }

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}
