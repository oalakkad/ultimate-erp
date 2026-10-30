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
  checklistItemCreateSchema,
  checklistItemUpdateSchema,
  checklistResponseSchema,
  createEmployeeRequestSchema,
  departmentListResponseSchema,
  departmentRequestSchema,
  departmentUpdateSchema,
  emergencyContactListResponseSchema,
  emergencyContactRequestSchema,
  employeeCandidatesResponseSchema,
  employeeDocumentListResponseSchema,
  employeeDocumentRequestSchema,
  employeeHistorySchema,
  employeeListQuerySchema,
  employeeListResponseSchema,
  employeeSchema,
  employeeStatusRequestSchema,
  type EmployeeStatus,
  fileDownloadResponseSchema,
  membershipChildParamSchema,
  membershipParamSchema,
  okResponseSchema,
  orgChartSchema,
  orgIdParamSchema,
  type PrivateDetails,
  privateDetailsResponseSchema,
  privateDetailsSchema,
  teamListResponseSchema,
  teamMembersRequestSchema,
  teamRequestSchema,
  teamUpdateSchema,
  updateEmployeeRequestSchema,
} from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { type z } from 'zod';
import { FieldCipherModule } from '../../platform/crypto/field-cipher.js';
import { ObjectStorage } from '../../platform/files/object-storage.js';
import { NoStoreInterceptor } from '../../platform/http/no-store.interceptor.js';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type AccessContext, CurrentAccess, RequirePermission } from '../access/access-context.js';
import { AccessGuard } from '../access/access.guard.js';
import { AccessModule } from '../access/access.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { PeopleService } from './people.service.js';

type Id = { id: string };
type ChildId = { id: string; childId: string };
const idPipe = new ZodValidationPipe(membershipParamSchema);
const childPipe = new ZodValidationPipe(membershipChildParamSchema);
const orgPipe = new ZodValidationPipe(orgIdParamSchema);
const READ = 'people.employee.read';
const MANAGE = 'people.employee.manage';
const RESTRICTED = 'people.employee.read_restricted';
const ORG = 'people.org.manage';

/**
 * Three levels of access (docs/modules/people.md §4); the guard admits anyone with a people
 * permission at some scope and the service decides per person and per section.
 */
@Controller()
@UseGuards(AccessGuard)
@UseInterceptors(NoStoreInterceptor)
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get('people')
  @ApiContract({
    summary: 'Directory of people I may see',
    auth: 'member',
    permission: READ,
    companyHost: true,
    query: employeeListQuerySchema,
    response: employeeListResponseSchema,
  })
  @RequirePermission(READ, 'own')
  list(
    @CurrentAccess() access: AccessContext,
    @Query(new ZodValidationPipe(employeeListQuerySchema))
    query: z.output<typeof employeeListQuerySchema>,
  ) {
    return this.people.list(access, query);
  }

  @Get('people/candidates')
  @ApiContract({
    summary: 'Active members without an employee record',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    response: employeeCandidatesResponseSchema,
  })
  @RequirePermission(MANAGE)
  candidates(@CurrentAccess() access: AccessContext) {
    return this.people.candidates(access);
  }

  @Post('people')
  @ApiContract({
    summary: 'Create the employee record of a member (E- numbers, onboarding checklist)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    body: createEmployeeRequestSchema,
    response: employeeSchema,
  })
  @RequirePermission(MANAGE)
  create(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(createEmployeeRequestSchema))
    body: z.output<typeof createEmployeeRequestSchema>,
  ) {
    return this.people.create(req, access, body);
  }

  @Get('people/:id')
  @ApiContract({
    summary: 'One person (details only where allowed)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: membershipParamSchema,
    response: employeeSchema,
  })
  @RequirePermission(READ, 'own')
  get(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.people.get(access, params.id);
  }

  @Patch('people/:id')
  @ApiContract({
    summary: 'Edit employment details (written to history)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: membershipParamSchema,
    body: updateEmployeeRequestSchema,
    response: employeeSchema,
  })
  @RequirePermission(MANAGE)
  update(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(updateEmployeeRequestSchema))
    body: z.output<typeof updateEmployeeRequestSchema>,
  ) {
    return this.people.update(req, access, params.id, body);
  }

  @Post('people/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: 'Change employment status ("left" suspends access to the company)',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: membershipParamSchema,
    body: employeeStatusRequestSchema,
    response: employeeSchema,
  })
  @RequirePermission(MANAGE)
  setStatus(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(employeeStatusRequestSchema))
    body: { status: EmployeeStatus; leaveDate?: string },
  ) {
    return this.people.setStatus(req, access, params.id, body.status, body.leaveDate);
  }

  @Get('people/:id/private')
  @ApiContract({
    summary: 'Private details (restricted; each read is audited)',
    auth: 'member',
    permission: RESTRICTED,
    companyHost: true,
    params: membershipParamSchema,
    response: privateDetailsResponseSchema,
  })
  @RequirePermission(RESTRICTED, 'own')
  privateDetails(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
  ) {
    return this.people.privateDetails(req, access, params.id);
  }

  @Put('people/:id/private')
  @ApiContract({
    summary: 'Save private details (stored encrypted)',
    auth: 'member',
    permission: RESTRICTED,
    companyHost: true,
    params: membershipParamSchema,
    body: privateDetailsSchema,
    response: privateDetailsResponseSchema,
  })
  @RequirePermission(RESTRICTED, 'own')
  setPrivate(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(privateDetailsSchema)) body: PrivateDetails,
  ) {
    return this.people.setPrivateDetails(req, access, params.id, body);
  }

  @Get('people/:id/emergency-contacts')
  @ApiContract({
    summary: 'Emergency contacts (restricted; audited)',
    auth: 'member',
    permission: RESTRICTED,
    companyHost: true,
    params: membershipParamSchema,
    response: emergencyContactListResponseSchema,
  })
  @RequirePermission(RESTRICTED, 'own')
  contacts(@Req() req: Request, @CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.people.contacts(req, access, params.id);
  }

  @Post('people/:id/emergency-contacts')
  @ApiContract({
    summary: 'Add an emergency contact',
    auth: 'member',
    permission: RESTRICTED,
    companyHost: true,
    params: membershipParamSchema,
    body: emergencyContactRequestSchema,
    response: emergencyContactListResponseSchema,
  })
  @RequirePermission(RESTRICTED, 'own')
  addContact(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(emergencyContactRequestSchema))
    body: { name: string; relationship: string; phone: string },
  ) {
    return this.people.addContact(req, access, params.id, body);
  }

  @Delete('people/:id/emergency-contacts/:childId')
  @ApiContract({
    summary: 'Remove an emergency contact',
    auth: 'member',
    permission: RESTRICTED,
    companyHost: true,
    params: membershipChildParamSchema,
    response: okResponseSchema,
  })
  @RequirePermission(RESTRICTED, 'own')
  async removeContact(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    await this.people.removeContact(req, access, params.id, params.childId);
    return { status: 'ok' } as const;
  }

  @Get('people/:id/history')
  @ApiContract({
    summary: 'Employment history (append-only)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: membershipParamSchema,
    response: employeeHistorySchema,
  })
  @RequirePermission(READ, 'own')
  history(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.people.historyOf(access, params.id);
  }

  @Get('people/:id/checklist')
  @ApiContract({
    summary: 'Onboarding and offboarding checklist',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: membershipParamSchema,
    response: checklistResponseSchema,
  })
  @RequirePermission(READ, 'own')
  checklist(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return this.people.checklist(access, params.id);
  }

  @Post('people/:id/checklist')
  @ApiContract({
    summary: 'Add a checklist item',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: membershipParamSchema,
    body: checklistItemCreateSchema,
    response: checklistResponseSchema,
  })
  @RequirePermission(MANAGE)
  addItem(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(checklistItemCreateSchema))
    body: { kind: 'onboarding' | 'offboarding'; title: string },
  ) {
    return this.people.addChecklistItem(req, access, params.id, body.kind, body.title);
  }

  @Patch('people/:id/checklist/:childId')
  @ApiContract({
    summary: 'Tick or untick a checklist item',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: membershipChildParamSchema,
    body: checklistItemUpdateSchema,
    response: checklistResponseSchema,
  })
  @RequirePermission(MANAGE)
  tick(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
    @Body(new ZodValidationPipe(checklistItemUpdateSchema)) body: { done: boolean },
  ) {
    return this.people.tickChecklist(req, access, params.id, params.childId, body.done);
  }

  @Get('people/:id/documents')
  @ApiContract({
    summary: 'Employee documents (confidential ones only for restricted readers)',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: membershipParamSchema,
    response: employeeDocumentListResponseSchema,
  })
  @RequirePermission(READ, 'own')
  async documents(@CurrentAccess() access: AccessContext, @Param(idPipe) params: Id) {
    return { items: await this.people.documents(access, params.id) };
  }

  @Post('people/:id/documents')
  @ApiContract({
    summary: 'Attach a file I uploaded',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: membershipParamSchema,
    body: employeeDocumentRequestSchema,
    response: employeeDocumentListResponseSchema,
  })
  @RequirePermission(MANAGE)
  async attach(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(idPipe) params: Id,
    @Body(new ZodValidationPipe(employeeDocumentRequestSchema))
    body: z.output<typeof employeeDocumentRequestSchema>,
  ) {
    return { items: await this.people.attachDocument(req, access, params.id, body) };
  }

  @Delete('people/:id/documents/:childId')
  @ApiContract({
    summary: 'Detach a document',
    auth: 'member',
    permission: MANAGE,
    companyHost: true,
    params: membershipChildParamSchema,
    response: okResponseSchema,
  })
  @RequirePermission(MANAGE)
  async detach(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    await this.people.detachDocument(req, access, params.id, params.childId);
    return { status: 'ok' } as const;
  }

  @Post('people/:id/documents/:childId/download')
  @HttpCode(HttpStatus.OK)
  @ApiContract({
    summary: '5-minute link to a clean document',
    auth: 'member',
    permission: READ,
    companyHost: true,
    params: membershipChildParamSchema,
    response: fileDownloadResponseSchema,
  })
  @RequirePermission(READ, 'own')
  download(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(childPipe) params: ChildId,
  ) {
    return this.people.documentDownload(req, access, params.id, params.childId);
  }

  @Get('departments')
  @ApiContract({
    summary: 'Departments',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: departmentListResponseSchema,
  })
  @RequirePermission(READ, 'own')
  departments(@CurrentAccess() access: AccessContext) {
    return this.people.departments(access);
  }

  @Post('departments')
  @ApiContract({
    summary: 'Create a department',
    auth: 'member',
    permission: ORG,
    companyHost: true,
    body: departmentRequestSchema,
    response: departmentListResponseSchema,
  })
  @RequirePermission(ORG)
  createDepartment(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(departmentRequestSchema)) body: { nameEn: string; nameAr: string },
  ) {
    return this.people.saveDepartment(req, access, null, body);
  }

  @Patch('departments/:id')
  @ApiContract({
    summary: 'Rename or archive a department',
    auth: 'member',
    permission: ORG,
    companyHost: true,
    params: orgIdParamSchema,
    body: departmentUpdateSchema,
    response: departmentListResponseSchema,
  })
  @RequirePermission(ORG)
  updateDepartment(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(orgPipe) params: Id,
    @Body(new ZodValidationPipe(departmentUpdateSchema))
    body: z.output<typeof departmentUpdateSchema>,
  ) {
    return this.people.saveDepartment(req, access, params.id, body);
  }

  @Get('teams')
  @ApiContract({
    summary: 'Teams with their lead and members',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: teamListResponseSchema,
  })
  @RequirePermission(READ, 'own')
  teams(@CurrentAccess() access: AccessContext) {
    return this.people.teamList(access);
  }

  @Post('teams')
  @ApiContract({
    summary: 'Create a team',
    auth: 'member',
    permission: ORG,
    companyHost: true,
    body: teamRequestSchema,
    response: teamListResponseSchema,
  })
  @RequirePermission(ORG)
  createTeam(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Body(new ZodValidationPipe(teamRequestSchema)) body: z.output<typeof teamRequestSchema>,
  ) {
    return this.people.saveTeam(req, access, null, body);
  }

  @Patch('teams/:id')
  @ApiContract({
    summary: 'Edit or archive a team',
    auth: 'member',
    permission: ORG,
    companyHost: true,
    params: orgIdParamSchema,
    body: teamUpdateSchema,
    response: teamListResponseSchema,
  })
  @RequirePermission(ORG)
  updateTeam(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(orgPipe) params: Id,
    @Body(new ZodValidationPipe(teamUpdateSchema)) body: z.output<typeof teamUpdateSchema>,
  ) {
    return this.people.saveTeam(req, access, params.id, body);
  }

  @Put('teams/:id/members')
  @ApiContract({
    summary: 'Replace the members of a team',
    auth: 'member',
    permission: ORG,
    companyHost: true,
    params: orgIdParamSchema,
    body: teamMembersRequestSchema,
    response: teamListResponseSchema,
  })
  @RequirePermission(ORG)
  setMembers(
    @Req() req: Request,
    @CurrentAccess() access: AccessContext,
    @Param(orgPipe) params: Id,
    @Body(new ZodValidationPipe(teamMembersRequestSchema)) body: { memberIds: string[] },
  ) {
    return this.people.setTeamMembers(req, access, params.id, body.memberIds);
  }

  @Get('org-chart')
  @ApiContract({
    summary: 'Reporting lines of the people I may see',
    auth: 'member',
    permission: READ,
    companyHost: true,
    response: orgChartSchema,
  })
  @RequirePermission(READ, 'own')
  orgChart(@CurrentAccess() access: AccessContext) {
    return this.people.orgChart(access);
  }
}

@Module({
  imports: [AccessModule, IdentityModule, FieldCipherModule],
  controllers: [PeopleController],
  providers: [PeopleService, ObjectStorage],
  exports: [PeopleService],
})
export class PeopleModule {}
