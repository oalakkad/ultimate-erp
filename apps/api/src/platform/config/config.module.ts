import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type AppConfig } from './config.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: Object.freeze(config) }],
      exports: [APP_CONFIG],
    };
  }
}
