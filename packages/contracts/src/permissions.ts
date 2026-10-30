import { z } from 'zod';

// Roles and permissions (docs/permissions.md, docs/modules/access.md). The single source used by
// the API (enforcement), the web app (showing/hiding — never enforcing) and tests.

export const PERMISSIONS = [
  'tenancy.settings.update',
  'access.members.read',
  'access.members.invite',
  'access.members.manage',
  'access.roles.assign',
  'people.employee.read',
  'people.employee.read_restricted',
  'clients.client.read',
  'clients.client.create',
  'clients.client.update',
  'clients.client.archive',
  'clients.client.export',
  'contracts.contract.read',
  'contracts.contract.manage',
  'contracts.contract.approve',
  'contracts.template.manage',
  'projects.project.read',
  'projects.project.create',
  'projects.project.manage',
  'projects.budget.update',
  'projects.budget.override',
  'tasks.allocation.manage',
  'time.entry.create',
  'time.timesheet.approve',
  'leave.request.approve',
  'payroll.run.prepare',
  'payroll.run.approve',
  'payroll.payslip.read',
  'billing.invoice.issue',
  'billing.payment.record',
  'audit.event.read',
  'exports.confidential',
  'system.health.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** How far a grant reaches: records about me, my teams, my projects, or the whole company. */
export const SCOPES = ['own', 'team', 'project', 'company'] as const;
export type Scope = (typeof SCOPES)[number];

export const ROLES = [
  'owner',
  'ceo',
  'manager',
  'team_leader',
  'employee',
  'finance',
  'hr_payroll',
  'technical_admin',
] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);
export const isRole = (value: string): value is Role =>
  (ROLES as readonly string[]).includes(value);

/** Granted only to accounts with two-factor on; never skipped by a trusted device. */
export const SENSITIVE_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'access.roles.assign',
  'people.employee.read_restricted',
  'projects.budget.override',
  'payroll.run.prepare',
  'payroll.run.approve',
  'payroll.payslip.read',
  'billing.payment.record',
  'audit.event.read',
  'exports.confidential',
]);

type Grants = Partial<Record<Permission, readonly Scope[]>>;

const company = ['company'] as const;
const own = ['own'] as const;
const team = ['team'] as const;
const project = ['project'] as const;

/** Fixed system roles (custom roles: later milestone). */
export const ROLE_GRANTS: Record<Role, Grants> = {
  owner: {
    'tenancy.settings.update': company,
    'access.members.read': company,
    'access.members.invite': company,
    'access.members.manage': company,
    'access.roles.assign': company,
    'people.employee.read': company,
    'people.employee.read_restricted': company,
    'clients.client.read': company,
    'clients.client.create': company,
    'clients.client.update': company,
    'clients.client.archive': company,
    'clients.client.export': company,
    'contracts.contract.read': company,
    'contracts.contract.manage': company,
    'contracts.contract.approve': company,
    'contracts.template.manage': company,
    'projects.project.read': company,
    'projects.project.create': company,
    'projects.project.manage': company,
    'projects.budget.update': company,
    'projects.budget.override': company,
    'tasks.allocation.manage': company,
    'time.entry.create': own,
    'time.timesheet.approve': company,
    'leave.request.approve': company,
    'billing.invoice.issue': company,
    'billing.payment.record': company,
    'audit.event.read': company,
    'exports.confidential': company,
  },
  ceo: {
    'tenancy.settings.update': company,
    'access.members.read': company,
    'access.members.invite': company,
    'access.members.manage': company,
    'access.roles.assign': company,
    'people.employee.read': company,
    'people.employee.read_restricted': company,
    'clients.client.read': company,
    'clients.client.create': company,
    'clients.client.update': company,
    'clients.client.archive': company,
    'clients.client.export': company,
    'contracts.contract.read': company,
    'contracts.contract.manage': company,
    'contracts.contract.approve': company,
    'contracts.template.manage': company,
    'projects.project.read': company,
    'projects.project.create': company,
    'projects.project.manage': company,
    'projects.budget.update': company,
    'projects.budget.override': company,
    'tasks.allocation.manage': company,
    'time.entry.create': own,
    'time.timesheet.approve': company,
    'leave.request.approve': company,
    'payroll.run.prepare': company,
    'payroll.run.approve': company,
    'payroll.payslip.read': company,
    'billing.invoice.issue': company,
    'billing.payment.record': company,
    'audit.event.read': company,
    'exports.confidential': company,
  },
  manager: {
    'access.members.read': company,
    'people.employee.read': team,
    'clients.client.read': company,
    'clients.client.create': company,
    'clients.client.update': company,
    'contracts.contract.read': company,
    'contracts.contract.manage': company,
    'projects.project.read': company,
    'projects.project.create': company,
    'projects.project.manage': project,
    'projects.budget.update': project,
    'tasks.allocation.manage': project,
    'time.entry.create': own,
    'time.timesheet.approve': ['project', 'team'],
    'leave.request.approve': team,
  },
  team_leader: {
    'people.employee.read': team,
    'clients.client.read': project,
    'contracts.contract.read': project,
    'projects.project.read': project,
    'tasks.allocation.manage': team,
    'time.entry.create': own,
    'time.timesheet.approve': team,
    'leave.request.approve': team,
  },
  employee: {
    'people.employee.read': own,
    'clients.client.read': project,
    'contracts.contract.read': project,
    'projects.project.read': project,
    'people.employee.read_restricted': own,
    'time.entry.create': own,
    'payroll.payslip.read': own,
  },
  // Not in the permissions.md matrix yet: completed when their modules exist (Phases 8, 11, 12).
  finance: {
    'clients.client.read': company,
    'contracts.contract.read': company,
    'projects.project.read': company,
    'time.entry.create': own,
    'billing.invoice.issue': company,
    'billing.payment.record': company,
  },
  hr_payroll: {
    'people.employee.read': company,
    'people.employee.read_restricted': company,
    'time.entry.create': own,
    'leave.request.approve': company,
    'payroll.run.prepare': company,
    'payroll.payslip.read': company,
  },
  technical_admin: {
    'system.health.read': company,
  },
};

/** Effective permissions of a set of roles: permission → scopes held. */
export type EffectivePermissions = ReadonlyMap<Permission, ReadonlySet<Scope>>;

export function effectivePermissions(roles: readonly Role[]): EffectivePermissions {
  const result = new Map<Permission, Set<Scope>>();
  for (const role of roles) {
    for (const [permission, scopes] of Object.entries(ROLE_GRANTS[role]) as [
      Permission,
      Scope[],
    ][]) {
      const set = result.get(permission) ?? new Set<Scope>();
      for (const scope of scopes) set.add(scope);
      result.set(permission, set);
    }
  }
  return result;
}

/** A held scope covers a required one if equal, if it is company-wide, or if `own` is required. */
const covers = (held: Scope, required: Scope) =>
  held === required || held === 'company' || required === 'own';

export function hasPermission(
  effective: EffectivePermissions,
  permission: Permission,
  scope: Scope = 'company',
): boolean {
  const held = effective.get(permission);
  return held !== undefined && [...held].some((s) => covers(s, scope));
}

/** True if holding these roles requires two-factor (any sensitive permission beyond `own`). */
export function isSensitive(roles: readonly Role[]): boolean {
  for (const [permission, scopes] of effectivePermissions(roles)) {
    if (SENSITIVE_PERMISSIONS.has(permission) && [...scopes].some((s) => s !== 'own')) return true;
  }
  return false;
}

/**
 * Separation-of-duties rule for assigning roles to **another** member (changing one's own roles
 * is always refused, by the service). An Owner — the company's root of trust — may grant any
 * role; everyone else may grant only roles whose permissions they already fully hold, and never
 * Owner. Every grant is audited. Decision 2026-10-27 (docs/modules/access.md §3).
 */
export function canGrant(actorRoles: readonly Role[], target: readonly Role[]): boolean {
  if (actorRoles.includes('owner')) return true;
  if (target.includes('owner')) return false;
  const actor = effectivePermissions(actorRoles);
  for (const [permission, scopes] of effectivePermissions(target)) {
    for (const scope of scopes) {
      if (!hasPermission(actor, permission, scope)) return false;
    }
  }
  return true;
}

/** Roles given to the person who creates a company: founder is usually Owner and CEO. */
export const FOUNDER_ROLES: readonly Role[] = ['owner', 'ceo'];

// --- API shapes -------------------------------------------------------------------------------

export const accessMeResponseSchema = z
  .object({
    tenantId: z.uuid(),
    membershipId: z.uuid(),
    roles: z.array(roleSchema),
    permissions: z.record(z.string(), z.array(z.enum(SCOPES))),
    twoFactorRequired: z.boolean(),
  })
  .strict();
export type AccessMeResponse = z.infer<typeof accessMeResponseSchema>;
