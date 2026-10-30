import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  contractIdParamSchema,
  contractListQuerySchema,
  contractListResponseSchema,
  contractSchema,
  contractVersionListResponseSchema,
  createContractRequestSchema,
  fileDownloadResponseSchema,
  newVersionRequestSchema,
  rejectRequestSchema,
  signRequestSchema,
  templateListResponseSchema,
  templateRequestSchema,
  templateSchema,
  templateUpdateSchema,
  terminateRequestSchema,
  updateContractRequestSchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { type z } from 'zod';
import { ObjectStorage } from '../../platform/files/object-storage.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess, RequirePermission } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ContractsService } from './contracts.service.js';

type Id = { id: string };
const idPipe = new ZodValidationPipe(contractIdParamSchema);
const READ = 'contracts.contract.read';
const MANAGE = 'contracts.contract.manage';
const TEMPLATES = 'contracts.template.manage';

@Controller('contract-templates')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class ContractTemplatesController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @ApiContract({
    summary: 'Contract and engagement-letter templates',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: templateListResponseSchema,
  })
  @RequirePermission(READ)
  async list(@CurrentAccess() access: AccessContext) {
    return { items: await this.contracts.templates(access) };
  }

  @Post()
  @ApiContract({
    summary: 'Create a bilingual template',
    auth: 'member',
    permission: TEMPLATES,
    companyHost: true,
    body: templateRequestSchema,
    response: templateSchema,
  })
  @RequirePermission(TEMPLATES)
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(templateRequestSchema))
    body: z.output<typeof templateRequestSchema>,
  ) {
    return this.contracts.createTemplate(req, access, body);
  }

  @Patch(':id')
  @ApiContract({
    summary: 'Edit a template (send its version)',
    auth: 'member',
    permission: TEMPLATES,
    companyHost: true,
    params: contractIdParamSchema,
    body: templateUpdateSchema,
    response: templateSchema,
  })
  @RequirePermission(TEMPLATES)
  update(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(templateUpdateSchema)) body: z.output<typeof templateUpdateSchema>,
  ) {
    return this.contracts.updateTemplate(req, access, params.id, body);
  }
}

@Controller('contracts')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @ApiContract({
    summary: 'Contracts and engagement letters (filters, newest first)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: contractListQuerySchema,
    response: contractListResponseSchema,
  })
  @RequirePermission(READ)
  list(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(contractListQuerySchema))
    query: z.output<typeof contractListQuerySchema>,
  ) {
    return this.contracts.list(access, query);
  }

  @Post()
  @ApiContract({
    summary: 'Create (from a template or blank); numbered CT-/EL-',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    body: createContractRequestSchema,
    response: contractSchema,
  })
  @RequirePermission(MANAGE)
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(createContractRequestSchema))
    body: z.output<typeof createContractRequestSchema>,
  ) {
    return this.contracts.create(req, access, body);
  }

  @Get(':id')
  @ApiContract({
    summary: 'One contract, with what I may do next',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: contractIdParamSchema,
    response: contractSchema,
  })
  @RequirePermission(READ)
  get(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.contracts.get(access, params.id);
  }

  @Patch(':id')
  @ApiContract({
    summary: 'Edit terms (draft only; send the version)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: contractIdParamSchema,
    body: updateContractRequestSchema,
    response: contractSchema,
  })
  @RequirePermission(MANAGE)
  update(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(updateContractRequestSchema))
    body: z.output<typeof updateContractRequestSchema>,
  ) {
    return this.contracts.update(req, access, params.id, body);
  }

  @Get(':id/versions')
  @ApiContract({
    summary: 'Text history, newest first',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: contractIdParamSchema,
    response: contractVersionListResponseSchema,
  })
  @RequirePermission(READ)
  async versions(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return { items: await this.contracts.versions(access, params.id) };
  }

  @Post(':id/versions')
  @ApiContract({
    summary: 'Save new text as the next version (draft only)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: contractIdParamSchema,
    body: newVersionRequestSchema,
    response: contractSchema,
  })
  @RequirePermission(MANAGE)
  newVersion(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(newVersionRequestSchema))
    body: z.output<typeof newVersionRequestSchema>,
  ) {
    return this.contracts.newVersion(req, access, params.id, body);
  }

  // Status changes. Each checks its own permission and source state in the service.
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Submit for approval',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: contractIdParamSchema,
    response: contractSchema,
  })
  @RequirePermission(READ)
  submit(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.contracts.transition(req, access, params.id, 'submit');
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Approve (not by the submitter)',
    auth: 'member',
    permission: 'contracts.contract.approve',
    companyHost: true,
    params: contractIdParamSchema,
    response: contractSchema,
  })
  @RequirePermission(READ)
  approve(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.contracts.transition(req, access, params.id, 'approve');
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Send back to draft with a reason (not by the submitter)',
    auth: 'member',
    permission: 'contracts.contract.approve',
    companyHost: true,
    params: contractIdParamSchema,
    body: rejectRequestSchema,
    response: contractSchema,
  })
  @RequirePermission(READ)
  reject(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(rejectRequestSchema)) body: { reason: string },
  ) {
    return this.contracts.transition(req, access, params.id, 'reject', body);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Record that it was sent to the client',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: contractIdParamSchema,
    response: contractSchema,
  })
  @RequirePermission(READ)
  send(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.contracts.transition(req, access, params.id, 'send');
  }

  @Post(':id/sign')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Record the counter-signed copy (uploaded file; not an e-signature)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: contractIdParamSchema,
    body: signRequestSchema,
    response: contractSchema,
  })
  @RequirePermission(READ)
  sign(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(signRequestSchema)) body: z.output<typeof signRequestSchema>,
  ) {
    return this.contracts.transition(req, access, params.id, 'sign', body);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Activate a signed contract',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: contractIdParamSchema,
    response: contractSchema,
  })
  @RequirePermission(READ)
  activate(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.contracts.transition(req, access, params.id, 'activate');
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Terminate with a reason',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: contractIdParamSchema,
    body: terminateRequestSchema,
    response: contractSchema,
  })
  @RequirePermission(READ)
  terminate(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(terminateRequestSchema)) body: { reason: string },
  ) {
    return this.contracts.transition(req, access, params.id, 'terminate', body);
  }

  @Post(':id/signed-copy/download')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: '5-minute link to the signed copy (clean files only)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: contractIdParamSchema,
    response: fileDownloadResponseSchema,
  })
  @RequirePermission(READ)
  download(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.contracts.signedCopyDownload(req, access, params.id);
  }
}

@Module({
  imports: [AccessModule, IdentityModule],
  controllers: [ContractTemplatesController, ContractsController],
  providers: [ContractsService, ObjectStorage],
  exports: [ContractsService],
})
export class ContractsModule {}
