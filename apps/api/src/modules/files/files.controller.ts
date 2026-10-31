import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Post,
  Req,
  UploadedFile as UploadedFileParam,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, MulterModule } from '@nestjs/platform-express';
import { fileDownloadResponseSchema, fileIdParamSchema, fileSchema } from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { memoryStorage } from 'multer';
import { type AppConfig } from '../../platform/config/config.js';
import { APP_CONFIG } from '../../platform/config/config.module.js';
import { ObjectStorage } from '../../platform/files/object-storage.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { FilesService, type UploadedFile } from './files.service.js';
import { Limit, ROUTE_LIMITS } from '../../platform/rate-limit/route-limit.js';

/** Upload and download files in this company (docs/modules/files-monitoring.md §2). */
@Controller('files')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Limit(ROUTE_LIMITS.upload)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiContract({
    summary: 'Upload a file (multipart field "file"); it is virus-scanned before use',
    auth: 'member',
    companyHost: true,
    response: fileSchema,
  })
  upload(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @UploadedFileParam() file: UploadedFile | undefined,
  ) {
    return this.files.upload(req, access, file);
  }

  @Get(':id')
  @ApiContract({
    summary: 'File details and scan status',
    auth: 'member',
    companyHost: true,
    params: fileIdParamSchema,
    response: fileSchema,
  })
  get(
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(fileIdParamSchema)) params: { id: string },
  ) {
    return this.files.get(access, params.id);
  }

  @Post(':id/download')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'A 5-minute signed download link (clean files only)',
    auth: 'member',
    companyHost: true,
    params: fileIdParamSchema,
    response: fileDownloadResponseSchema,
  })
  download(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(new ZodValidationPipe(fileIdParamSchema)) params: { id: string },
  ) {
    return this.files.downloadUrl(req, access, params.id);
  }
}

@Module({
  imports: [
    AccessModule,
    IdentityModule,
    // Uploads are held in memory up to the configured limit; larger ones are refused (413).
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        storage: memoryStorage(),
        limits: { fileSize: config.FILE_MAX_BYTES, files: 1, fields: 0, parts: 2 },
      }),
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService, ObjectStorage],
})
export class FilesModule {}
