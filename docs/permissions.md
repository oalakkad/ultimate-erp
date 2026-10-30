# Roles and Permissions

Status: **Draft — Phase 0.** Final matrix is built module by module.

## 1. Model

- **Permission key**: `module.resource.action`, e.g. `projects.budget.update`, `payroll.run.approve`. Defined once in `packages/contracts` and used by API, web (to hide UI) and tests.
- **Scope** attached to a grant: `own` (records about me / assigned to me), `team` (teams I lead/manage), `project` (projects I'm a member/manager of), `company` (whole tenant).
- **Role** = named bundle of (permission, scope). Tenants get system roles (read-only templates) and may create custom roles.
- A user may hold several roles in a tenant; effective permissions = union, but **separation-of-duties rules** can still block (e.g. cannot approve a pay run you prepared).
- Permission checks happen on the server for every request. Hiding a button is UX only.

## 2. Role levels — who is who

| Level | Role | Lives in | Business data access |
|---|---|---|---|
| Platform | **Platform Operator** (us, the SaaS vendor) | Platform | **None by default.** Manages tenants, plans, platform health. Tenant data access only via tenant-approved, time-boxed, audited support grant. |
| Platform | **Technical Administrator** | Platform or tenant | **None.** System health, error monitoring (PII-scrubbed), integrations config, diagnostics. |
| Tenant | **Owner** | Tenant | Creator of the company. Can manage roles and billing of the subscription. Cannot be removed without ownership transfer. |
| Tenant | **CEO / Executive Admin** | Tenant | Broad company-scope access, but payroll, payment approval, role management and confidential exports are *separate explicit permissions* (granted by default to this role template but removable). |
| Tenant | **Manager** | Tenant | Assigned departments/teams/projects; approvals within scope. |
| Tenant | **Team Leader** | Tenant | Team members' tasks, workload, timesheets, leave approvals (first level). |
| Tenant | **Employee** | Tenant | Own workspace: own tasks, time, leave, attendance, own payslips. |
| Tenant | **Finance** (suggested) | Tenant | Invoicing, payments. |
| Tenant | **HR / Payroll** (suggested) | Tenant | Employee records, leave policy, payroll preparation. |

"Super Admin" is deliberately **not** a role name — it implies unrestricted access. The tenant's top role is Owner/CEO and is still bounded by explicit permissions; the platform roles have no default access to tenant business data.

## 3. Initial matrix (excerpt — expanded per module)

| Permission | Owner | CEO | Manager | Team Lead | Employee | Tech Admin |
|---|---|---|---|---|---|---|
| tenancy.settings.update | company | company | — | — | — | — |
| access.members.read | company | company | company | — | — | — |
| access.members.invite | company | company | — | — | — | — |
| access.members.manage | company | company | — | — | — | — |
| access.roles.assign | company | company* | — | — | — | — |
| people.employee.read | company | company | team | team (basic fields) | own | — |
| people.employee.read_restricted (civil ID, bank, emergency) | company | company* | — | — | own | — |
| clients.client.read | company | company | company | project | project | — |
| clients.client.create | company | company | company | — | — | — |
| clients.client.update | company | company | company | — | — | — |
| clients.client.archive | company | company | — | — | — | — |
| clients.client.export | company | company | — | — | — | — |
| contracts.contract.read | company | company | company | project | project | — |
| contracts.contract.manage | company | company | company | — | — | — |
| contracts.contract.approve | company | company | — | — | — | — |
| contracts.template.manage | company | company | — | — | — | — |
| projects.project.create | company | company | company | — | — | — |
| projects.budget.update | company | company | project | — | — | — |
| projects.budget.override | company | company* | — | — | — | — |
| tasks.allocation.manage | company | company | project | team | — | — |
| time.entry.create | own | own | own | own | own | — |
| time.timesheet.approve | company | company | project/team | team | — | — |
| leave.request.approve | company | company | team | team | — | — |
| payroll.run.prepare | — | company* | — | — | — | — |
| payroll.run.approve | — | company* | — | — | — | — |
| payroll.payslip.read | — | company* | — | — | own | — |
| billing.invoice.issue | company | company | — | — | — | — |
| billing.payment.record | company | company | — | — | — | — |
| audit.event.read | company | company | — | — | — | — |
| exports.confidential | company* | company* | — | — | — | — |
| system.health.read | — | — | — | — | — | platform |

`*` = granted in template; sensitive (requires two-factor). `—` = not granted.

This table is **machine-checked**: `packages/contracts/src/permissions.spec.ts` parses it and fails if `permissions.ts` differs. Finance and HR/Payroll role definitions live only in `permissions.ts` until those modules exist. Sensitive permissions (two-factor required, never trusted-device) are defined there too; a grant at `own` scope is never sensitive (an employee reading their own payslip does not force MFA on every employee). Milestone 1.3b renamed `access.roles.manage` to `access.roles.assign` (fixed roles: assigning, not editing).
