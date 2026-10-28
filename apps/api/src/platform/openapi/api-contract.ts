import { SetMetadata } from '@nestjs/common';
import { type Permission } from '@ultimate-erp/contracts';
import { type z } from 'zod';

/**
 * Who may call a route:
 * - `public`: anyone · `session`: signed in · `member`: signed-in member of the company on this
 *   host (AccessGuard), optionally with a `permission`.
 */
export type RouteAuth = 'public' | 'session' | 'member';

/** The documented contract of one route; the OpenAPI document is generated from these. */
export interface RouteContract {
  summary: string;
  auth: RouteAuth;
  permission?: Permission;
  /** Route lives on a company's host (`<slug>.<domain>`) rather than any host. */
  companyHost?: boolean;
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
  response?: z.ZodType;
  /** Success status; defaults to 200. */
  status?: number;
}

export const API_CONTRACT = 'openapi:contract';

/** Declares a route's contract next to its code. A test fails for any route without one. */
export const ApiContract = (contract: RouteContract) => SetMetadata(API_CONTRACT, contract);
