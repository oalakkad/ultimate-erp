import { type DynamicModule, Module } from '@nestjs/common';
import { API_PREFIX } from '@ultimate-erp/contracts';
import { LoggerModule } from 'nestjs-pino';
import { type AppConfig } from '../config/config.js';
import { buildLoggerOptions } from './logger-options.js';

@Module({})
export class LoggingModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            ...buildLoggerOptions(config),
            // The request ID is assigned earlier by requestIdMiddleware.
            genReqId: (req) => req.id,
            customAttributeKeys: { reqId: 'requestId' },
            autoLogging: { ignore: (req) => req.url === `/${API_PREFIX}/health/live` },
          },
        }),
      ],
    };
  }
}
