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
  allocationPreviewRequestSchema,
  allocationPreviewSchema,
  attachDocumentRequestSchema,
  commentListResponseSchema,
  commentRequestSchema,
  createTaskRequestSchema,
  fileDownloadResponseSchema,
  okResponseSchema,
  setAllocationsRequestSchema,
  setDependenciesRequestSchema,
  taskActivitySchema,
  taskChildParamSchema,
  taskDocumentListResponseSchema,
  taskIdParamSchema,
  taskListQuerySchema,
  taskListResponseSchema,
  taskSchema,
  taskStatusRequestSchema,
  type TaskStatus,
  updateTaskRequestSchema,
  workloadQuerySchema,
  workloadSchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { type z } from 'zod';
import { ObjectStorage } from '../../platform/files/object-storage.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { NotifierModule } from '../../platform/notifications/notifier.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess, RequirePermission } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TasksService } from './tasks.service.js';

type Id = { id: string };
type ChildId = { id: string; childId: string };
const idPipe = new ZodValidationPipe(taskIdParamSchema);
const childPipe = new ZodValidationPipe(taskChildParamSchema);
const READ = 'tasks.task.read';
const MANAGE = 'tasks.task.manage';
const WORK = 'tasks.task.work';
const ALLOCATE = 'tasks.allocation.manage';

/**
 * The guard admits the lowest scope a role may hold (own for employees); the service then checks
 * the specific task or project (docs/modules/tasks.md §5).
 */
@Controller()
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('tasks')
  @ApiContract({
    summary: 'Tasks I may see (filters: project, client, status, assignee, overdue, search)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: taskListQuerySchema,
    response: taskListResponseSchema,
  })
  @RequirePermission(READ, 'own')
  list(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(taskListQuerySchema)) query: z.output<typeof taskListQuerySchema>,
  ) {
    return this.tasks.list(access, query);
  }

  @Post('tasks')
  @ApiContract({
    summary: 'Create a task with its allocations, atomically and within the project budget',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    body: createTaskRequestSchema,
    response: taskSchema,
  })
  @RequirePermission(MANAGE, 'project')
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(createTaskRequestSchema))
    body: z.output<typeof createTaskRequestSchema>,
  ) {
    return this.tasks.create(req, access, body);
  }

  @Post('tasks/allocation-preview')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'What an allocation does to the remaining budget and to workloads (nothing saved)',
    auth: 'member',
    permission: ALLOCATE,
    companyHost: true,
    body: allocationPreviewRequestSchema,
    response: allocationPreviewSchema,
  })
  @RequirePermission(ALLOCATE, 'project')
  preview(
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(allocationPreviewRequestSchema))
    body: z.output<typeof allocationPreviewRequestSchema>,
  ) {
    return this.tasks.preview(access, body);
  }

  @Get('workload')
  @ApiContract({
    summary: 'Open tasks and allocated hours per person (a project team, or everyone)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: workloadQuerySchema,
    response: workloadSchema,
  })
  @RequirePermission(READ, 'project')
  workload(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(workloadQuerySchema)) query: { projectId?: string },
  ) {
    return this.tasks.workload(access, query.projectId);
  }

  @Get('tasks/:id')
  @ApiContract({
    summary: 'One task',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: taskIdParamSchema,
    response: taskSchema,
  })
  @RequirePermission(READ, 'own')
  get(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.tasks.get(access, params.id);
  }

  @Patch('tasks/:id')
  @ApiContract({
    summary: 'Edit task details (optimistic version check)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: taskIdParamSchema,
    body: updateTaskRequestSchema,
    response: taskSchema,
  })
  @RequirePermission(MANAGE, 'project')
  update(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(updateTaskRequestSchema))
    body: z.output<typeof updateTaskRequestSchema>,
  ) {
    return this.tasks.update(req, access, params.id, body);
  }

  @Post('tasks/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Move the task through the workflow',
    auth: 'member',
    permission: WORK,
    companyHost: true,
    params: taskIdParamSchema,
    body: taskStatusRequestSchema,
    response: taskSchema,
  })
  @RequirePermission(WORK, 'own')
  setStatus(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(taskStatusRequestSchema)) body: { status: TaskStatus },
  ) {
    return this.tasks.setStatus(req, access, params.id, body.status);
  }

  @Put('tasks/:id/allocations')
  @ApiContract({
    summary: 'Replace who works on the task and their hours (budget-checked)',
    auth: 'member',
    permission: ALLOCATE,
    companyHost: true,
    params: taskIdParamSchema,
    body: setAllocationsRequestSchema,
    response: taskSchema,
  })
  @RequirePermission(ALLOCATE, 'project')
  setAllocations(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(setAllocationsRequestSchema))
    body: z.output<typeof setAllocationsRequestSchema>,
  ) {
    return this.tasks.setAllocations(req, access, params.id, body);
  }

  @Put('tasks/:id/dependencies')
  @ApiContract({
    summary: 'Replace the tasks this one is blocked by (same project, no loops)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: taskIdParamSchema,
    body: setDependenciesRequestSchema,
    response: taskSchema,
  })
  @RequirePermission(MANAGE, 'project')
  setDependencies(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(setDependenciesRequestSchema)) body: { blockedBy: string[] },
  ) {
    return this.tasks.setDependencies(req, access, params.id, body.blockedBy);
  }

  @Get('tasks/:id/comments')
  @ApiContract({
    summary: 'Comments, oldest first',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: taskIdParamSchema,
    response: commentListResponseSchema,
  })
  @RequirePermission(READ, 'own')
  async comments(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return { items: await this.tasks.comments(access, params.id) };
  }

  @Post('tasks/:id/comments')
  @ApiContract({
    summary: 'Add a comment (comments cannot be edited or deleted)',
    auth: 'member',
    permission: WORK,
    companyHost: true,
    params: taskIdParamSchema,
    body: commentRequestSchema,
    response: commentListResponseSchema,
  })
  @RequirePermission(WORK, 'own')
  async addComment(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(commentRequestSchema)) body: { body: string },
  ) {
    return { items: await this.tasks.addComment(req, access, params.id, body.body) };
  }

  @Get('tasks/:id/documents')
  @ApiContract({
    summary: 'Documents attached to a task',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: taskIdParamSchema,
    response: taskDocumentListResponseSchema,
  })
  @RequirePermission(READ, 'own')
  async documents(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return { items: await this.tasks.documents(access, params.id) };
  }

  @Post('tasks/:id/documents')
  @ApiContract({
    summary: 'Attach a file I uploaded (POST /files first)',
    auth: 'member',
    permission: WORK,
    companyHost: true,
    params: taskIdParamSchema,
    body: attachDocumentRequestSchema,
    response: taskDocumentListResponseSchema,
  })
  @RequirePermission(WORK, 'own')
  async attach(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(attachDocumentRequestSchema)) body: { fileId: string },
  ) {
    return { items: await this.tasks.attachDocument(req, access, params.id, body.fileId) };
  }

  @Delete('tasks/:id/documents/:childId')
  @ApiContract({
    summary: 'Detach a document (the file record is kept)',
    auth: 'member',
    permission: WORK,
    companyHost: true,
    params: taskChildParamSchema,
    response: okResponseSchema,
  })
  @RequirePermission(WORK, 'own')
  async detach(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    await this.tasks.detachDocument(req, access, params.id, params.childId);
    return { status: 'ok' } as const;
  }

  @Post('tasks/:id/documents/:childId/download')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: '5-minute signed link to a clean document',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: taskChildParamSchema,
    response: fileDownloadResponseSchema,
  })
  @RequirePermission(READ, 'own')
  download(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    return this.tasks.documentDownload(req, access, params.id, params.childId);
  }

  @Get('tasks/:id/activity')
  @ApiContract({
    summary: 'Activity timeline of a task',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: taskIdParamSchema,
    response: taskActivitySchema,
  })
  @RequirePermission(READ, 'own')
  activity(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.tasks.activity(access, params.id);
  }
}

@Module({
  imports: [AccessModule, IdentityModule, NotifierModule],
  controllers: [TasksController],
  providers: [TasksService, ObjectStorage],
  exports: [TasksService],
})
export class TasksModule {}
