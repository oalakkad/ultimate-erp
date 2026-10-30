import { z } from 'zod';

// Attendance (docs/modules/attendance.md §5).

export const ATTENDANCE_KINDS = ['in', 'out'] as const;
export const ATTENDANCE_DAY_STATUSES = [
  'present',
  'incomplete',
  'absent',
  'leave',
  'holiday',
  'weekend',
  'upcoming',
] as const;

const isoDate = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time');
const bilingual = z.object({ en: z.string(), ar: z.string() }).strict();
const text = (max: number) => z.string().trim().max(max);
const personRef = z.object({ membershipId: z.uuid(), name: z.string() }).strict();

export const attendanceSettingsSchema = z
  .object({
    allowWeb: z.boolean(),
    rotationSeconds: z.number().int().min(10).max(300),
    minMinutesBetween: z.number().int().min(0).max(60),
  })
  .strict();
export type AttendanceSettings = z.infer<typeof attendanceSettingsSchema>;
export const attendanceSettingsUpdateSchema = attendanceSettingsSchema.partial().strict();

export const siteRequestSchema = z
  .object({ nameEn: text(120).min(1), nameAr: text(120).min(1) })
  .strict();
export const siteUpdateSchema = siteRequestSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();
export const siteListResponseSchema = z
  .object({
    items: z.array(z.object({ id: z.uuid(), name: bilingual, archived: z.boolean() }).strict()),
  })
  .strict();

/** What the kiosk shows: the code (as a link to scan) and how long it stays valid. */
export const kioskCodeSchema = z
  .object({
    code: z.string(),
    expiresInSeconds: z.number().int(),
    rotationSeconds: z.number().int(),
  })
  .strict();

const shiftFields = {
  nameEn: text(120).min(1),
  nameAr: text(120).min(1),
  startTime: hhmm,
  endTime: hhmm,
  graceMinutes: z.number().int().min(0).max(240),
  breakMinutes: z.number().int().min(0).max(480),
};
export const shiftRequestSchema = z
  .object(shiftFields)
  .strict()
  .refine((s) => s.endTime > s.startTime, { path: ['endTime'], message: 'before_start' });
export const shiftUpdateSchema = z
  .object(shiftFields)
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict();
export const shiftSchema = z
  .object({
    id: z.uuid(),
    name: bilingual,
    startTime: z.string(),
    endTime: z.string(),
    graceMinutes: z.number().int(),
    breakMinutes: z.number().int(),
    archived: z.boolean(),
    people: z.array(personRef),
  })
  .strict();
export const shiftListResponseSchema = z.object({ items: z.array(shiftSchema) }).strict();
export const shiftAssignmentSchema = z.object({ shiftId: z.uuid().nullable() }).strict();

export const checkRequestSchema = z.object({ code: z.string().max(200).optional() }).strict();

export const attendanceEventSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(ATTENDANCE_KINDS),
    at: z.iso.datetime(),
    method: z.enum(['qr', 'web', 'manual']),
    site: bilingual.nullable(),
  })
  .strict();

export const myAttendanceSchema = z
  .object({
    date: isoDate,
    events: z.array(attendanceEventSchema),
    next: z.enum(ATTENDANCE_KINDS),
    allowWeb: z.boolean(),
    shift: z
      .object({ name: bilingual, startTime: z.string(), endTime: z.string() })
      .strict()
      .nullable(),
  })
  .strict();

export const attendanceDaySchema = z
  .object({
    date: isoDate,
    status: z.enum(ATTENDANCE_DAY_STATUSES),
    firstIn: z.iso.datetime().nullable(),
    lastOut: z.iso.datetime().nullable(),
    workedMinutes: z.number().int(),
    lateMinutes: z.number().int(),
    earlyMinutes: z.number().int(),
    /** Hours logged on timesheets that day (Phase 7), for comparison. */
    loggedHours: z.string(),
  })
  .strict();

export const attendanceSummaryQuerySchema = z
  .object({ from: isoDate, to: isoDate, membershipId: z.uuid().optional() })
  .strict()
  .refine((q) => q.to >= q.from && Date.parse(q.to) - Date.parse(q.from) <= 92 * 86_400_000, {
    path: ['to'],
    message: 'range',
  });
export const attendanceSummarySchema = z
  .object({
    person: personRef,
    from: isoDate,
    to: isoDate,
    days: z.array(attendanceDaySchema),
    totals: z
      .object({
        present: z.number().int(),
        absent: z.number().int(),
        late: z.number().int(),
        early: z.number().int(),
        leave: z.number().int(),
        workedMinutes: z.number().int(),
        loggedHours: z.string(),
      })
      .strict(),
  })
  .strict();

export const attendanceTodaySchema = z
  .object({
    date: isoDate,
    items: z.array(
      personRef
        .extend({
          state: z.enum(['in', 'out', 'not_in', 'leave', 'off']),
          since: z.iso.datetime().nullable(),
          lateMinutes: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();

export const correctionRequestSchema = z
  .object({
    kind: z.enum(ATTENDANCE_KINDS),
    at: z.iso.datetime({ offset: true }),
    reason: text(1000).min(1),
  })
  .strict();
export const correctionDecisionSchema = z.object({ note: text(1000).optional() }).strict();
export const correctionSchema = z
  .object({
    id: z.uuid(),
    person: personRef,
    kind: z.enum(ATTENDANCE_KINDS),
    at: z.iso.datetime(),
    reason: z.string(),
    status: z.enum(['pending', 'approved', 'rejected']),
    decidedByName: z.string().nullable(),
    note: z.string().nullable(),
    actions: z.array(z.enum(['approve', 'reject'])),
  })
  .strict();
export const correctionListQuerySchema = z
  .object({ view: z.enum(['mine', 'approvals']).default('mine') })
  .strict();
export const correctionListResponseSchema = z.object({ items: z.array(correctionSchema) }).strict();
export const attendanceIdParamSchema = z.object({ id: z.uuid() }).strict();
