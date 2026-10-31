import {
  Controller,
  Get,
  Header,
  Module,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  type ReportKey,
  reportCatalogSchema,
  reportKeyParamSchema,
  reportQuerySchema,
  reportSchema,
} from '@ultimate-erp/contracts';
import { type Request, type Response } from 'express';
import { z } from 'zod';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { AttendanceModule } from '../attendance/attendance.controller.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ReportsService } from './reports.service.js';

// The reader's language decides names (client, project, leave type) in rows and exports.
const runQuerySchema = reportQuerySchema.and(
  z.object({ locale: z.enum(['en', 'ar']).optional() }).strict(),
);
type RunQuery = z.output<typeof runQuerySchema>;
const keyPipe = new ZodValidationPipe(reportKeyParamSchema);

/**
 * Reports (docs/modules/reports.md). Any member reaches these routes; which reports — and
 * which rows — they may see is decided per report from their permissions, in the service.
 */
@Controller('reports')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiContract({
    summary: 'The reports I may run',
    auth: 'member',
    companyHost: true,
    response: reportCatalogSchema,
  })
  catalog(@CurrentAccess() access: AccessContext) {
    return this.reports.catalog(access);
  }

  @Get(':key')
  @ApiContract({
    summary: 'Run a report (columns, rows, totals) — permission checked per report',
    auth: 'member',
    companyHost: true,
    params: reportKeyParamSchema,
    query: runQuerySchema,
    response: reportSchema,
  })
  run(
    @CurrentAccess() access: AccessContext,
    @Param(keyPipe) params: { key: ReportKey },
    @Query(new ZodValidationPipe(runQuerySchema)) query: RunQuery,
  ) {
    return this.reports.run(access, params.key, query);
  }

  @Get(':key/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiContract({
    summary: 'Export a report as CSV (audited; payroll needs confidential export)',
    auth: 'member',
    companyHost: true,
    params: reportKeyParamSchema,
    query: runQuerySchema,
    response: z.string(),
  })
  async export(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentAccess() access: AccessContext,
    @Param(keyPipe) params: { key: ReportKey },
    @Query(new ZodValidationPipe(runQuerySchema)) query: RunQuery,
  ) {
    const csv = await this.reports.exportCsv(req, access, params.key, query);
    res.setHeader('Content-Disposition', `attachment; filename="${params.key}.csv"`);
    return csv;
  }
}

@Module({
  imports: [AccessModule, IdentityModule, AttendanceModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
