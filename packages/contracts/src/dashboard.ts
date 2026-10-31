import { z } from 'zod';

// Executive dashboard (docs/modules/shell-dashboard.md §4). Every section is present only if
// the caller may see it; numbers are computed from real records — never estimated.

/** Audit actions the activity feed shows (internal noise such as notification sends is left out). */
export const ACTIVITY_ACTIONS = [
  'access.company.created',
  'access.invitation.created',
  'access.invitation.revoked',
  'access.invitation.accepted',
  'access.member.roles_changed',
  'access.member.removed',
  'files.file.uploaded',
  'files.file.infected',
  'clients.client.created',
  'clients.client.archived',
  'contracts.contract.created',
  'contracts.contract.approved',
  'contracts.contract.signed',
  'projects.project.created',
  'projects.project.status_changed',
  'projects.budget.revised',
  'tasks.task.created',
  'tasks.allocation.override',
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const activityItemSchema = z
  .object({
    id: z.uuid(),
    action: z.enum(ACTIVITY_ACTIONS),
    occurredAt: z.iso.datetime(),
    /** Who did it (a member's name), or null for the system / a removed account. */
    actorName: z.string().nullable(),
  })
  .strict();
export type ActivityItem = z.infer<typeof activityItemSchema>;

export const dashboardSummarySchema = z
  .object({
    /** Company set-up progress (people who can invite). */
    setup: z
      .object({ invitationSent: z.boolean(), colleagueJoined: z.boolean() })
      .strict()
      .optional(),
    /** People in the company (people who can read the member list). */
    team: z
      .object({
        activeMembers: z.number().int().min(0),
        pendingInvitations: z.number().int().min(0).nullable(),
      })
      .strict()
      .optional(),
    /** Clients (people who can read clients). */
    clients: z
      .object({ active: z.number().int().min(0), newThisMonth: z.number().int().min(0) })
      .strict()
      .optional(),
    /** Contracts (people who can read contracts): active, and ending within 60 days. */
    contracts: z
      .object({ active: z.number().int().min(0), expiringSoon: z.number().int().min(0) })
      .strict()
      .optional(),
    /** Projects (people who can read projects company-wide): active, and ending within 30 days. */
    projects: z
      .object({
        active: z.number().int().min(0),
        endingSoon: z.number().int().min(0),
        /** Open projects whose allocated hours exceed the budget. */
        overBudget: z.number().int().min(0),
      })
      .strict()
      .optional(),
    /** My tasks (anyone who has tasks): open, and overdue among them; company-wide overdue for company readers. */
    tasks: z
      .object({
        mineOpen: z.number().int().min(0),
        mineOverdue: z.number().int().min(0),
        companyOverdue: z.number().int().min(0).nullable(),
      })
      .strict()
      .optional(),
    /** My hours this week, and entries waiting for my approval (approvers only). */
    time: z
      .object({
        thisWeekHours: z.string(),
        waitingForMe: z.number().int().min(0).nullable(),
      })
      .strict()
      .optional(),
    /** Leave: people I may see who are away today, and requests waiting for my decision. */
    leave: z
      .object({
        onLeaveToday: z.number().int().min(0),
        waitingForMe: z.number().int().min(0).nullable(),
      })
      .strict()
      .optional(),
    /** Attendance of people I may see today. */
    attendance: z
      .object({ inNow: z.number().int().min(0), lateToday: z.number().int().min(0) })
      .strict()
      .optional(),
    /** Receivables (invoice readers): outstanding and overdue amounts in KWD. */
    billing: z
      .object({
        outstanding: z.string(),
        overdue: z.string(),
        overdueCount: z.number().int().min(0),
      })
      .strict()
      .optional(),
    /** Expenses: my open claims; claims waiting for my decision; approved, not yet reimbursed. */
    expenses: z
      .object({
        mineOpen: z.number().int().min(0),
        waitingForMe: z.number().int().min(0).nullable(),
        toReimburse: z
          .object({ count: z.number().int().min(0), amount: z.string() })
          .strict()
          .nullable(),
      })
      .strict()
      .optional(),
    /** Latest business events (people who can read the audit log). */
    activity: z
      .object({ items: z.array(activityItemSchema) })
      .strict()
      .optional(),
  })
  .strict();
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
