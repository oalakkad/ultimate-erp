import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canGrant,
  effectivePermissions,
  hasPermission,
  isSensitive,
  type Permission,
  PERMISSIONS,
  ROLE_GRANTS,
  type Role,
  type Scope,
} from './permissions.js';

/** The matrix in docs/permissions.md §3: permission → role column → scopes. */
function readMatrix(): Map<string, Map<Role, Scope[]>> {
  const doc = readFileSync(new URL('../../../docs/permissions.md', import.meta.url), 'utf8');
  const columns: Role[] = ['owner', 'ceo', 'manager', 'team_leader', 'employee', 'technical_admin'];
  const rows = new Map<string, Map<Role, Scope[]>>();
  const section = doc.slice(doc.indexOf('| Permission | Owner |'));
  for (const line of section.split('\n').slice(2)) {
    if (!line.startsWith('|')) break;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const permission = (cells[0] ?? '').split(' ')[0] ?? '';
    const byRole = new Map<Role, Scope[]>();
    columns.forEach((role, i) => {
      const cell = (cells[i + 1] ?? '')
        .replace('*', '')
        .replace(/\(.*\)/, '')
        .trim();
      if (cell === '—' || cell === '') return;
      // "platform" (technical admin) is granted at company scope inside a tenant.
      byRole.set(role, cell === 'platform' ? ['company'] : (cell.split('/') as Scope[]));
    });
    rows.set(permission, byRole);
  }
  return rows;
}

describe('permissions.md matrix matches the code', () => {
  const matrix = readMatrix();
  const documentedRoles: Role[] = [
    'owner',
    'ceo',
    'manager',
    'team_leader',
    'employee',
    'technical_admin',
  ];

  it('documents exactly the permissions the code defines', () => {
    expect([...matrix.keys()].sort()).toEqual([...PERMISSIONS].sort());
  });

  it.each(documentedRoles)('role %s grants exactly what the matrix says', (role) => {
    for (const permission of PERMISSIONS) {
      const documented = [...(matrix.get(permission)?.get(role) ?? [])].sort();
      const coded = [...(ROLE_GRANTS[role][permission] ?? [])].sort();
      expect(coded, `${role} / ${permission}`).toEqual(documented);
    }
  });
});

describe('permission evaluation', () => {
  it('company scope covers team, project and own; own covers only own', () => {
    const owner = effectivePermissions(['owner']);
    expect(hasPermission(owner, 'projects.budget.update', 'project')).toBe(true);
    const employee = effectivePermissions(['employee']);
    expect(hasPermission(employee, 'people.employee.read', 'own')).toBe(true);
    expect(hasPermission(employee, 'people.employee.read', 'company')).toBe(false);
    expect(hasPermission(employee, 'audit.event.read')).toBe(false);
  });

  it('team does not cover project and vice versa', () => {
    const lead = effectivePermissions(['team_leader']);
    expect(hasPermission(lead, 'leave.request.approve', 'team')).toBe(true);
    expect(hasPermission(lead, 'leave.request.approve', 'project')).toBe(false);
  });

  it('several roles combine', () => {
    const both = effectivePermissions(['employee', 'finance']);
    expect(hasPermission(both, 'billing.invoice.issue')).toBe(true);
    expect(hasPermission(both, 'payroll.payslip.read', 'own')).toBe(true);
  });

  it('technical admin has no business data permissions', () => {
    const business = PERMISSIONS.filter((p: Permission) => p !== 'system.health.read');
    const tech = effectivePermissions(['technical_admin']);
    expect(business.filter((p) => hasPermission(tech, p, 'own'))).toEqual([]);
  });
});

describe('sensitive roles (two-factor required)', () => {
  it.each([
    ['owner', true],
    ['ceo', true],
    ['finance', true],
    ['hr_payroll', true],
    ['manager', false],
    ['team_leader', false],
    ['employee', false],
    ['technical_admin', false],
  ] as const)('%s → %s', (role, sensitive) => {
    expect(isSensitive([role])).toBe(sensitive);
  });
});

describe('canGrant (no self-elevation beyond own permissions)', () => {
  it('lets an Owner grant any role, including Owner and CEO', () => {
    expect(canGrant(['owner'], ['owner'])).toBe(true);
    expect(canGrant(['owner'], ['ceo'])).toBe(true);
  });

  it('lets a CEO grant roles within their permissions, but never Owner', () => {
    expect(canGrant(['ceo'], ['manager'])).toBe(true);
    expect(canGrant(['ceo'], ['hr_payroll'])).toBe(true);
    expect(canGrant(['ceo'], ['owner'])).toBe(false);
  });

  it('refuses granting a role broader than the actor', () => {
    expect(canGrant(['manager'], ['ceo'])).toBe(false);
    expect(canGrant(['team_leader'], ['manager'])).toBe(false);
  });
});
