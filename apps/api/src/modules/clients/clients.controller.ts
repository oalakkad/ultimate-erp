import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
  attachDocumentRequestSchema,
  clientActivitySchema,
  clientChildParamSchema,
  clientDocumentListResponseSchema,
  clientIdParamSchema,
  clientListQuerySchema,
  clientListResponseSchema,
  clientSchema,
  contactListResponseSchema,
  contactRequestSchema,
  contactSchema,
  contactUpdateSchema,
  createClientRequestSchema,
  fileDownloadResponseSchema,
  interactionListResponseSchema,
  interactionRequestSchema,
  interactionSchema,
  okResponseSchema,
  updateClientRequestSchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { z } from 'zod';
import { ObjectStorage } from '../../platform/files/object-storage.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess, RequirePermission } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ClientsService } from './clients.service.js';
import { Limit, ROUTE_LIMITS } from '../../platform/rate-limit/route-limit.js';

type Id = { id: string };
type ChildId = { id: string; childId: string };
const idPipe = new ZodValidationPipe(clientIdParamSchema);
const childPipe = new ZodValidationPipe(clientChildParamSchema);
const READ = 'clients.client.read';
const UPDATE = 'clients.client.update';

/** Clients / CRM (docs/modules/clients.md §5). Every route: member of this company + permission. */
@Controller('clients')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @ApiContract({
    summary: 'Search, filter, sort and page clients',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: clientListQuerySchema,
    response: clientListResponseSchema,
  })
  @RequirePermission(READ)
  list(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(clientListQuerySchema))
    query: z.output<typeof clientListQuerySchema>,
  ) {
    return this.clients.list(access, query);
  }

  @Limit(ROUTE_LIMITS.export)
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="clients.csv"')
  @ApiContract({
    summary: 'Export the filtered client list as CSV (audited)',
    auth: 'member',
    permission: 'clients.client.export',
    companyHost: true,
    query: clientListQuerySchema,
    response: z.string(),
  })
  @RequirePermission('clients.client.export')
  export(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(clientListQuerySchema))
    query: z.output<typeof clientListQuerySchema>,
  ) {
    return this.clients.exportCsv(req, access, query);
  }

  @Post()
  @ApiContract({
    summary: 'Create a client (409 on duplicate CR number or similar name unless confirmed)',
    auth: 'member',
    permission: 'clients.client.create',
    companyHost: true,
    body: createClientRequestSchema,
    response: clientSchema,
  })
  @RequirePermission('clients.client.create')
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(createClientRequestSchema))
    body: z.output<typeof createClientRequestSchema>,
  ) {
    return this.clients.create(req, access, body);
  }

  @Get(':id')
  @ApiContract({
    summary: 'One client',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: clientIdParamSchema,
    response: clientSchema,
  })
  @RequirePermission(READ)
  get(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.clients.get(access, params.id);
  }

  @Patch(':id')
  @ApiContract({
    summary: 'Edit a client (send the version you read; stale ⇒ 409)',
    auth: 'member',
    permission: UPDATE,
    companyHost: true,
    params: clientIdParamSchema,
    body: updateClientRequestSchema,
    response: clientSchema,
  })
  @RequirePermission(UPDATE)
  update(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(updateClientRequestSchema))
    body: z.output<typeof updateClientRequestSchema>,
  ) {
    return this.clients.update(req, access, params.id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Archive (hide from lists and pickers; history kept)',
    auth: 'member',
    permission: 'clients.client.archive',
    companyHost: true,
    params: clientIdParamSchema,
    response: clientSchema,
  })
  @RequirePermission('clients.client.archive')
  archive(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.clients.setArchived(req, access, params.id, true);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Restore an archived client',
    auth: 'member',
    permission: 'clients.client.archive',
    companyHost: true,
    params: clientIdParamSchema,
    response: clientSchema,
  })
  @RequirePermission('clients.client.archive')
  restore(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.clients.setArchived(req, access, params.id, false);
  }

  @Get(':id/contacts')
  @ApiContract({
    summary: 'Contacts of a client',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: clientIdParamSchema,
    response: contactListResponseSchema,
  })
  @RequirePermission(READ)
  async contacts(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return { items: await this.clients.contacts(access, params.id) };
  }

  @Post(':id/contacts')
  @ApiContract({
    summary: 'Add a contact (isPrimary moves the primary flag)',
    auth: 'member',
    permission: UPDATE,
    companyHost: true,
    params: clientIdParamSchema,
    body: contactRequestSchema,
    response: contactSchema,
  })
  @RequirePermission(UPDATE)
  addContact(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(contactRequestSchema)) body: z.output<typeof contactRequestSchema>,
  ) {
    return this.clients.addContact(req, access, params.id, body);
  }

  @Patch(':id/contacts/:childId')
  @ApiContract({
    summary: 'Edit a contact',
    auth: 'member',
    permission: UPDATE,
    companyHost: true,
    params: clientChildParamSchema,
    body: contactUpdateSchema,
    response: contactSchema,
  })
  @RequirePermission(UPDATE)
  updateContact(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
    @Body(new ZodValidationPipe(contactUpdateSchema)) body: z.output<typeof contactUpdateSchema>,
  ) {
    return this.clients.updateContact(req, access, params.id, params.childId, body);
  }

  @Post(':id/contacts/:childId/archive')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Archive a contact',
    auth: 'member',
    permission: UPDATE,
    companyHost: true,
    params: clientChildParamSchema,
    response: contactSchema,
  })
  @RequirePermission(UPDATE)
  archiveContact(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    return this.clients.updateContact(req, access, params.id, params.childId, { archived: true });
  }

  @Get(':id/interactions')
  @ApiContract({
    summary: 'Communication history, newest first',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: clientIdParamSchema,
    response: interactionListResponseSchema,
  })
  @RequirePermission(READ)
  async interactions(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return { items: await this.clients.interactions(access, params.id) };
  }

  @Post(':id/interactions')
  @ApiContract({
    summary: 'Log a note, call, meeting or email',
    auth: 'member',
    permission: UPDATE,
    companyHost: true,
    params: clientIdParamSchema,
    body: interactionRequestSchema,
    response: interactionSchema,
  })
  @RequirePermission(UPDATE)
  logInteraction(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(interactionRequestSchema))
    body: z.output<typeof interactionRequestSchema>,
  ) {
    return this.clients.logInteraction(req, access, params.id, body);
  }

  @Get(':id/documents')
  @ApiContract({
    summary: 'Documents attached to a client',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: clientIdParamSchema,
    response: clientDocumentListResponseSchema,
  })
  @RequirePermission(READ)
  async documents(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return { items: await this.clients.documents(access, params.id) };
  }

  @Post(':id/documents')
  @ApiContract({
    summary: 'Attach a file I uploaded (POST /files first)',
    auth: 'member',
    permission: UPDATE,
    companyHost: true,
    params: clientIdParamSchema,
    body: attachDocumentRequestSchema,
    response: clientDocumentListResponseSchema,
  })
  @RequirePermission(UPDATE)
  async attach(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(attachDocumentRequestSchema)) body: { fileId: string },
  ) {
    return { items: await this.clients.attachDocument(req, access, params.id, body.fileId) };
  }

  @Delete(':id/documents/:childId')
  @ApiContract({
    summary: 'Detach a document (the file record is kept)',
    auth: 'member',
    permission: UPDATE,
    companyHost: true,
    params: clientChildParamSchema,
    response: okResponseSchema,
  })
  @RequirePermission(UPDATE)
  async detach(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    await this.clients.detachDocument(req, access, params.id, params.childId);
    return { status: 'ok' } as const;
  }

  @Post(':id/documents/:childId/download')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: '5-minute signed link to a clean document',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: clientChildParamSchema,
    response: fileDownloadResponseSchema,
  })
  @RequirePermission(READ)
  download(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    return this.clients.documentDownload(req, access, params.id, params.childId);
  }

  @Get(':id/activity')
  @ApiContract({
    summary: 'Activity timeline of a client',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: clientIdParamSchema,
    response: clientActivitySchema,
  })
  @RequirePermission(READ)
  activity(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.clients.activity(access, params.id);
  }
}

@Module({
  imports: [AccessModule, IdentityModule],
  controllers: [ClientsController],
  providers: [ClientsService, ObjectStorage],
})
export class ClientsModule {}
