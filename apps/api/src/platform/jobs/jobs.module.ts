import { type DynamicModule, Global, Module } from '@nestjs/common';
import { JOB_ROLE, JobQueue, type JobRole } from './job-queue.js';
import { PayloadSealer } from './payload-sealer.js';

@Global()
@Module({})
export class JobsModule {
  static forRoot(role: JobRole): DynamicModule {
    return {
      module: JobsModule,
      providers: [{ provide: JOB_ROLE, useValue: role }, JobQueue, PayloadSealer],
      exports: [JobQueue, PayloadSealer],
    };
  }
}
