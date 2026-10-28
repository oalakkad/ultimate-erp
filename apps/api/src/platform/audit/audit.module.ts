import { Global, Module } from '@nestjs/common';
import { AuditLog } from './audit-log.js';

@Global()
@Module({ providers: [AuditLog], exports: [AuditLog] })
export class AuditModule {}
