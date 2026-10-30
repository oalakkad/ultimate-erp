import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  attachDocumentRequestSchema,
  budgetRevisionListResponseSchema,
  budgetRevisionRequestSchema,
  createProjectRequestSchema,
  fileDownloadResponseSchema,
  okResponseSchema,
  projectActivitySchema,
  projectChildParamSchema,
  projectDocumentListResponseSchema,
  projectHoursSchema,
  projectIdParamSchema,
  projectListQuerySchema,
  projectListResponseSchema,
  projectSchema,
  projectStatusRequestSchema,
  type ProjectStatus,
  setMembersRequestSchema,
  updateProjectRequestSchema,
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
import { ProjectsService } from './projects.service.js';

type Id = { id: string };
type ChildId = { id: string; childId: string };
const idPipe = new ZodValidationPipe(projectIdParamSchema);
const childPipe = new ZodValidationPipe(projectChildParamSchema);
const READ = 'projects.project.read';
const CREATE = 'projects.project.create';
const MANAGE = 'projects.project.manage';
const BUDGET = 'projects.budget.update';

/**
 * The guard admits project-scope holders (team leaders, employees, managers); the service then
 * checks that the person actually works on the project (docs/modules/projects.md §5).
 */
@Controller('projects')
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiContract({
    summary: 'Projects I may see (company-wide, or the ones I work on)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: projectListQuerySchema,
    response: projectListResponseSchema,
  })
  @RequirePermission(READ, 'project')
  list(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(projectListQuerySchema))
    query: z.output<typeof projectListQuerySchema>,
  ) {
    return this.projects.list(access, query);
  }

  @Post()
  @ApiContract({
    summary: 'Create a project (budget revision 1, manager on the team)',
    auth: 'member',
    permission: CREATE,
    companyHost: true,
    body: createProjectRequestSchema,
    response: projectSchema,
  })
  @RequirePermission(CREATE)
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(createProjectRequestSchema))
    body: z.output<typeof createProjectRequestSchema>,
  ) {
    return this.projects.create(req, access, body);
  }

  @Get(':id')
  @ApiContract({
    summary: 'One project',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: projectIdParamSchema,
    response: projectSchema,
  })
  @RequirePermission(READ, 'project')
  get(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.projects.get(access, params.id);
  }

  @Patch(':id')
  @ApiContract({
    summary: 'Edit project details (optimistic version check)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: projectIdParamSchema,
    body: updateProjectRequestSchema,
    response: projectSchema,
  })
  @RequirePermission(MANAGE, 'project')
  update(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(updateProjectRequestSchema))
    body: z.output<typeof updateProjectRequestSchema>,
  ) {
    return this.projects.update(req, access, params.id, body);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Move the project to another status',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: projectIdParamSchema,
    body: projectStatusRequestSchema,
    response: projectSchema,
  })
  @RequirePermission(MANAGE, 'project')
  setStatus(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(projectStatusRequestSchema)) body: { status: ProjectStatus },
  ) {
    return this.projects.setStatus(req, access, params.id, body.status);
  }

  @Put(':id/members')
  @ApiContract({
    summary: 'Replace the team (the manager always stays on it)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: projectIdParamSchema,
    body: setMembersRequestSchema,
    response: projectSchema,
  })
  @RequirePermission(MANAGE, 'project')
  setMembers(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(setMembersRequestSchema)) body: { memberIds: string[] },
  ) {
    return this.projects.setMembers(req, access, params.id, body.memberIds);
  }

  @Get(':id/budget')
  @ApiContract({
    summary: 'Budget history, newest first',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: projectIdParamSchema,
    response: budgetRevisionListResponseSchema,
  })
  @RequirePermission(READ, 'project')
  async revisions(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return { items: await this.projects.revisions(access, params.id) };
  }

  @Post(':id/budget')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Revise the budget (new revision with a reason)',
    auth: 'member',
    permission: BUDGET,
    companyHost: true,
    params: projectIdParamSchema,
    body: budgetRevisionRequestSchema,
    response: projectSchema,
  })
  @RequirePermission(BUDGET, 'project')
  revise(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(budgetRevisionRequestSchema))
    body: z.output<typeof budgetRevisionRequestSchema>,
  ) {
    return this.projects.revise(req, access, params.id, body);
  }

  @Get(':id/hours')
  @ApiContract({
    summary: 'Budgeted, allocated, logged, approved and billable hours',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: projectIdParamSchema,
    response: projectHoursSchema,
  })
  @RequirePermission(READ, 'project')
  hours(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.projects.hours(access, params.id);
  }

  @Get(':id/documents')
  @ApiContract({
    summary: 'Documents attached to a project',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: projectIdParamSchema,
    response: projectDocumentListResponseSchema,
  })
  @RequirePermission(READ, 'project')
  async documents(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return { items: await this.projects.documents(access, params.id) };
  }

  @Post(':id/documents')
  @ApiContract({
    summary: 'Attach a file I uploaded (POST /files first)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: projectIdParamSchema,
    body: attachDocumentRequestSchema,
    response: projectDocumentListResponseSchema,
  })
  @RequirePermission(MANAGE, 'project')
  async attach(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(attachDocumentRequestSchema)) body: { fileId: string },
  ) {
    return { items: await this.projects.attachDocument(req, access, params.id, body.fileId) };
  }

  @Delete(':id/documents/:childId')
  @ApiContract({
    summary: 'Detach a document (the file record is kept)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: projectChildParamSchema,
    response: okResponseSchema,
  })
  @RequirePermission(MANAGE, 'project')
  async detach(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    await this.projects.detachDocument(req, access, params.id, params.childId);
    return { status: 'ok' } as const;
  }

  @Post(':id/documents/:childId/download')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: '5-minute signed link to a clean document',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: projectChildParamSchema,
    response: fileDownloadResponseSchema,
  })
  @RequirePermission(READ, 'project')
  download(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    return this.projects.documentDownload(req, access, params.id, params.childId);
  }

  @Get(':id/activity')
  @ApiContract({
    summary: 'Activity timeline of a project',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: projectIdParamSchema,
    response: projectActivitySchema,
  })
  @RequirePermission(READ, 'project')
  activity(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.projects.activity(access, params.id);
  }
}

@Module({
  imports: [AccessModule, IdentityModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ObjectStorage],
  exports: [ProjectsService],
})
export class ProjectsModule {}
