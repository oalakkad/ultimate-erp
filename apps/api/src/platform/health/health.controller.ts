import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import { type HealthResponse, type LivenessResponse } from '@ultimate-erp/contracts';
import { type Response } from 'express';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Readiness: 200 when all dependencies are up, 503 otherwise. */
  @Get()
  @Header('Cache-Control', 'no-store')
  async readiness(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const report = await this.health.check();
    if (report.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }

  /** Liveness: the process is running and serving HTTP. */
  @Get('live')
  @Header('Cache-Control', 'no-store')
  liveness(): LivenessResponse {
    return { status: 'ok' };
  }
}
