import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { createCompanyRequestSchema, createCompanyResponseSchema } from '@ultimate-erp/contracts';
import { type Request } from 'express';
import { type z } from 'zod';
import { ApiContract } from '../../platform/openapi/api-contract.js';
import { ZodValidationPipe } from '../../platform/validation/zod-validation.pipe.js';
import { type Identity } from '../identity/identity.service.js';
import { CurrentIdentity, SessionGuard } from '../identity/session.guard.js';
import { CompaniesService } from './companies.service.js';

/** Company onboarding. Works on any host (the company does not exist yet). */
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  @ApiContract({
    summary: 'Create a company; the caller becomes Owner and CEO',
    auth: 'session',
    body: createCompanyRequestSchema,
    response: createCompanyResponseSchema,
    status: 201,
  })
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionGuard)
  create(
    @Req() req: Request,
    @CurrentIdentity() identity: Identity,
    @Body(new ZodValidationPipe(createCompanyRequestSchema))
    body: z.infer<typeof createCompanyRequestSchema>,
  ) {
    return this.companies.create(req, identity, body);
  }
}
