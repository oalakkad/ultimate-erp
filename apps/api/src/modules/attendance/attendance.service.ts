import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type AttendanceSettings,
  attendanceSettingsSchema,
  hasPermission,
} from '@ultimate-erp/contracts';
import {
  attendanceCodeUses,
  attendanceCorrections,
  attendanceEvents,
  attendanceSites,
  companySettings,
  employees,
  leaveRequests,
  membershipRoles,
  memberships,
  publicHolidays,
  shiftAssignments,
  shifts,
  teamMembers,
  teams,
  type TenantTransaction,
  timeEntries,
} from '@ultimate-erp/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import { type Request } from 'express';
import { AuditLog } from '../../platform/audit/audit-log.js';
import { type AppConfig } from '../../platform/config/config.js';
import { APP_CONFIG } from '../../platform/config/config.module.js';
import { pgErrorCode, UNIQUE_VIOLATION } from '../../platform/database/pg-error.js';
import { TenantDatabase } from '../../platform/database/tenant-database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { messageFor } from '../../platform/errors/to-error-response.js';
import { Notifier } from '../../platform/notifications/notifier.js';
import { type AccessContext } from '../access/access-context.js';
import { kuwaitToday } from '../contracts/contracts.service.js';
import { IdentityService } from '../identity/identity.service.js';
import { teamScopeOf } from '../people/people.service.js';
import { formatHours, hundredths } from '../projects/projects.service.js';

type EmployeeRow = typeof employees.$inferSelect;
type ShiftRow = typeof shifts.$inferSelect;
type EventRow = typeof attendanceEvents.$inferSelect;

const notFound = () => new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, messageFor('NOT_FOUND'));
const forbidden = () => new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, messageFor('FORBIDDEN'));
const invalid = (path: string, code: string) =>
  new AppError(
    'VALIDATION_FAILED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    messageFor('VALIDATION_FAILED'),
    [{ path, code }],
  );
const conflict = (path: string, code: string, message: string) =>
  new AppError('CONFLICT', HttpStatus.CONFLICT, message, [{ path, code }]);

const DEFAULT_SETTINGS: AttendanceSettings = {
  allowWeb: true,
  rotationSeconds: 30,
  minMinutesBetween: 1,
};
const KUWAIT_OFFSET_MS = 3 * 3_600_000;
const DAY = 86_400_000;
/** The Kuwait calendar date of an instant. */
export const kuwaitDateOf = (at: Date) =>
  new Date(at.getTime() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
/** The instant of a Kuwait wall-clock time on a date ("08:00:00" on "2026-11-01"). */
const kuwaitInstant = (date: string, time: string) =>
  new Date(`${date}T${time.slice(0, 8).padEnd(8, ':00')}+03:00`);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/**
 * Rotating kiosk codes (docs/modules/attendance.md §2): `site.window.signature`, an HMAC over the
 * company, site and 30-second window with a key derived from the server secret. Nothing is stored;
 * a code is valid in its window and the next one only.
 */
@Injectable()
export class KioskCodes {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(hkdfSync('sha256', config.AUTH_SECRET, '', 'erp:attendance-qr:v1', 32));
  }

  window(now: number, rotationSeconds: number) {
    return Math.floor(now / 1000 / rotationSeconds);
  }

  sign(tenantId: string, siteId: string, window: number) {
    const sig = createHmac('sha256', this.key)
      .update(`${tenantId}:${siteId}:${window}`)
      .digest('base64url')
      .slice(0, 27);
    return `${siteId}.${window}.${sig}`;
  }

  /** The site of a valid code, or null (forged, other company, expired). */
  verify(
    tenantId: string,
    code: string,
    now: number,
    rotationSeconds: number,
  ): { siteId: string; window: number } | null {
    const [siteId, windowText, sig] = code.split('.');
    if (!siteId || !windowText || !sig || !/^\d+$/.test(windowText)) return null;
    const window = Number(windowText);
    const current = this.window(now, rotationSeconds);
    if (window !== current && window !== current - 1) return null;
    const expected = Buffer.from(this.sign(tenantId, siteId, window));
    const given = Buffer.from(code);
    return expected.length === given.length && timingSafeEqual(expected, given)
      ? { siteId, window }
      : null;
  }
}

/** Attendance (docs/modules/attendance.md). */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly identity: IdentityService,
    private readonly codes: KioskCodes,
  ) {}

  // --- settings, sites, shifts -----------------------------------------------------------------

  private async settingsOf(tx: TenantTransaction): Promise<AttendanceSettings> {
    const [row] = await tx
      .select()
      .from(companySettings)
      .where(eq(companySettings.key, 'attendance'));
    const parsed = attendanceSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      ...(row?.value as object | undefined),
    });
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  async settings(access: AccessContext) {
    return this.database.withTenant(access.tenantId, (tx) => this.settingsOf(tx));
  }

  async updateSettings(
    req: Request,
    access: AccessContext,
    input: { [K in keyof AttendanceSettings]?: AttendanceSettings[K] | undefined },
  ) {
    this.assertManage(access);
    return this.database.withTenant(access.tenantId, async (tx) => {
      const changes = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const value = { ...(await this.settingsOf(tx)), ...changes };
      await tx
        .insert(companySettings)
        .values({
          tenantId: access.tenantId,
          key: 'attendance',
          value,
          updatedByUserId: access.userId,
        })
        .onConflictDoUpdate({
          target: [companySettings.tenantId, companySettings.key],
          set: { value, updatedByUserId: access.userId },
        });
      await this.record(
        tx,
        req,
        access,
        'settings',
        access.tenantId,
        'attendance.settings.updated',
        { fields: Object.keys(input) },
      );
      return value;
    });
  }

  async sites(access: AccessContext) {
    const rows = await this.database.withTenant(access.tenantId, (tx) =>
      tx.select().from(attendanceSites).orderBy(asc(attendanceSites.createdAt)),
    );
    return {
      items: rows.map((s) => ({
        id: s.id,
        name: { en: s.nameEn, ar: s.nameAr },
        archived: s.archivedAt !== null,
      })),
    };
  }

  async saveSite(
    req: Request,
    access: AccessContext,
    id: string | null,
    input: {
      nameEn?: string | undefined;
      nameAr?: string | undefined;
      archived?: boolean | undefined;
    },
  ) {
    this.assertManage(access);
    await this.database.withTenant(access.tenantId, async (tx) => {
      if (id === null) {
        await tx.insert(attendanceSites).values({
          tenantId: access.tenantId,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
        });
      } else {
        const updated = await tx
          .update(attendanceSites)
          .set({
            ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
            ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
            ...(input.archived !== undefined
              ? { archivedAt: input.archived ? new Date() : null }
              : {}),
          })
          .where(eq(attendanceSites.id, id))
          .returning();
        if (updated.length === 0) throw notFound();
      }
      await this.record(
        tx,
        req,
        access,
        'attendance_site',
        id ?? access.tenantId,
        'attendance.site.saved',
      );
    });
    return this.sites(access);
  }

  /** The kiosk's current code; shown on a screen at the site by a signed-in administrator. */
  async kioskCode(access: AccessContext, siteId: string, now = Date.now()) {
    this.assertManage(access);
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [site] = await tx
        .select()
        .from(attendanceSites)
        .where(and(eq(attendanceSites.id, siteId), isNull(attendanceSites.archivedAt)));
      if (!site) throw notFound();
      const { rotationSeconds } = await this.settingsOf(tx);
      const window = this.codes.window(now, rotationSeconds);
      const expiresInSeconds = (window + 1) * rotationSeconds - Math.floor(now / 1000);
      return {
        code: this.codes.sign(access.tenantId, siteId, window),
        expiresInSeconds,
        rotationSeconds,
      };
    });
  }

  async shiftList(access: AccessContext) {
    const { rows, assigned } = await this.database.withTenant(access.tenantId, async (tx) => ({
      rows: await tx.select().from(shifts).orderBy(asc(shifts.startTime)),
      assigned: await tx.select().from(shiftAssignments),
    }));
    const names = await this.namesOf(
      access,
      assigned.map((a) => a.membershipId),
    );
    return {
      items: rows.map((s) => ({
        id: s.id,
        name: { en: s.nameEn, ar: s.nameAr },
        startTime: s.startTime.slice(0, 5),
        endTime: s.endTime.slice(0, 5),
        graceMinutes: s.graceMinutes,
        breakMinutes: s.breakMinutes,
        archived: s.archivedAt !== null,
        people: assigned
          .filter((a) => a.shiftId === s.id && names.has(a.membershipId))
          .map((a) => ({ membershipId: a.membershipId, name: names.get(a.membershipId) ?? '' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })),
    };
  }

  async saveShift(
    req: Request,
    access: AccessContext,
    id: string | null,
    input: {
      nameEn?: string | undefined;
      nameAr?: string | undefined;
      startTime?: string | undefined;
      endTime?: string | undefined;
      graceMinutes?: number | undefined;
      breakMinutes?: number | undefined;
      archived?: boolean | undefined;
    },
  ) {
    this.assertManage(access);
    await this.database.withTenant(access.tenantId, async (tx) => {
      const { archived, ...fields } = input;
      const values = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      if (id === null) {
        await tx.insert(shifts).values({
          tenantId: access.tenantId,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          startTime: input.startTime ?? '08:00',
          endTime: input.endTime ?? '16:00',
          ...values,
        });
      } else {
        const updated = await tx
          .update(shifts)
          .set({
            ...values,
            ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
          })
          .where(eq(shifts.id, id))
          .returning();
        if (updated.length === 0) throw notFound();
        const [row] = updated;
        if (row && row.endTime <= row.startTime) throw invalid('endTime', 'before_start');
      }
      await this.record(tx, req, access, 'shift', id ?? access.tenantId, 'attendance.shift.saved');
    });
    return this.shiftList(access);
  }

  async assign(req: Request, access: AccessContext, membershipId: string, shiftId: string | null) {
    this.assertManage(access);
    await this.database.withTenant(access.tenantId, async (tx) => {
      await this.employeeOf(tx, membershipId);
      if (shiftId === null) {
        await tx.delete(shiftAssignments).where(eq(shiftAssignments.membershipId, membershipId));
      } else {
        const [shift] = await tx
          .select()
          .from(shifts)
          .where(and(eq(shifts.id, shiftId), isNull(shifts.archivedAt)));
        if (!shift) throw invalid('shiftId', 'not_found');
        await tx
          .insert(shiftAssignments)
          .values({ tenantId: access.tenantId, membershipId, shiftId })
          .onConflictDoUpdate({
            target: [shiftAssignments.tenantId, shiftAssignments.membershipId],
            set: { shiftId },
          });
      }
      await this.record(tx, req, access, 'employee', membershipId, 'attendance.shift.assigned', {
        shiftId,
      });
    });
    return this.shiftList(access);
  }

  private assertManage(access: AccessContext) {
    if (!hasPermission(access.permissions, 'attendance.manage', 'company')) throw forbidden();
  }

  // --- checking in and out -------------------------------------------------------------------

  /** QR (with a kiosk code) or web check-in/out; the kind alternates and the time is the server's. */
  async check(req: Request, access: AccessContext, code?: string, now = new Date()) {
    try {
      return await this.database.withTenant(access.tenantId, async (tx) => {
        const employee = await this.employeeOf(tx, access.membershipId, true);
        if (employee.status === 'left') throw forbidden();
        const settings = await this.settingsOf(tx);
        let siteId: string | null = null;
        if (code !== undefined) {
          const valid = this.codes.verify(
            access.tenantId,
            code,
            now.getTime(),
            settings.rotationSeconds,
          );
          if (!valid) throw invalid('code', 'invalid_or_expired');
          const [site] = await tx
            .select()
            .from(attendanceSites)
            .where(and(eq(attendanceSites.id, valid.siteId), isNull(attendanceSites.archivedAt)));
          if (!site) throw invalid('code', 'invalid_or_expired');
          await tx.insert(attendanceCodeUses).values({
            tenantId: access.tenantId,
            membershipId: access.membershipId,
            siteId: valid.siteId,
            window: valid.window,
          });
          siteId = valid.siteId;
        } else if (!settings.allowWeb) {
          throw conflict(
            'code',
            'qr_required',
            'This company records attendance with the office QR code only.',
          );
        }
        const [last] = await tx
          .select()
          .from(attendanceEvents)
          .where(eq(attendanceEvents.membershipId, access.membershipId))
          .orderBy(desc(attendanceEvents.at))
          .limit(1);
        if (last && minutesBetween(last.at, now) < settings.minMinutesBetween) {
          throw conflict('at', 'too_soon', 'You checked in or out a moment ago.');
        }
        const kind =
          last && last.kind === 'in' && kuwaitDateOf(last.at) === kuwaitDateOf(now) ? 'out' : 'in';
        const [event] = await tx
          .insert(attendanceEvents)
          .values({
            tenantId: access.tenantId,
            membershipId: access.membershipId,
            kind,
            at: now,
            method: siteId ? 'qr' : 'web',
            siteId,
          })
          .returning();
        if (!event) throw new Error('attendance insert returned nothing');
        await this.record(
          tx,
          req,
          access,
          'employee',
          access.membershipId,
          `attendance.check.${kind}`,
          { method: event.method },
        );
        return this.myDay(tx, access, now);
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION)
        throw conflict('code', 'code_used', 'This code was already used. Scan the new one.');
      throw err;
    }
  }

  async me(access: AccessContext) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      await this.employeeOf(tx, access.membershipId);
      return this.myDay(tx, access, new Date());
    });
  }

  private async myDay(tx: TenantTransaction, access: AccessContext, now: Date) {
    const date = kuwaitDateOf(now);
    const events = await this.eventsBetween(tx, [access.membershipId], date, date);
    const sites = new Map((await tx.select().from(attendanceSites)).map((s) => [s.id, s]));
    const shift = await this.shiftOf(tx, access.membershipId);
    const last = events.at(-1);
    return {
      date,
      events: events.map((e) => {
        const site = e.siteId ? sites.get(e.siteId) : undefined;
        return {
          id: e.id,
          kind: e.kind,
          at: e.at.toISOString(),
          method: e.method,
          site: site ? { en: site.nameEn, ar: site.nameAr } : null,
        };
      }),
      next: last?.kind === 'in' ? ('out' as const) : ('in' as const),
      allowWeb: (await this.settingsOf(tx)).allowWeb,
      shift: shift
        ? {
            name: { en: shift.nameEn, ar: shift.nameAr },
            startTime: shift.startTime.slice(0, 5),
            endTime: shift.endTime.slice(0, 5),
          }
        : null,
    };
  }

  // --- summaries -----------------------------------------------------------------------------

  async summary(access: AccessContext, from: string, to: string, membershipId?: string) {
    const target = membershipId ?? access.membershipId;
    const result = await this.database.withTenant(access.tenantId, async (tx) => {
      if (!(await this.canSee(tx, access, target))) throw notFound();
      const employee = await this.employeeOf(tx, target);
      return this.daysOf(tx, employee, from, to);
    });
    const names = await this.namesOf(access, [target]);
    const days = result;
    return {
      person: { membershipId: target, name: names.get(target) ?? '' },
      from,
      to,
      days,
      totals: {
        present: days.filter((d) => d.status === 'present' || d.status === 'incomplete').length,
        absent: days.filter((d) => d.status === 'absent').length,
        late: days.filter((d) => d.lateMinutes > 0).length,
        early: days.filter((d) => d.earlyMinutes > 0).length,
        leave: days.filter((d) => d.status === 'leave').length,
        workedMinutes: days.reduce((t, d) => t + d.workedMinutes, 0),
        loggedHours: formatHours(days.reduce((t, d) => t + hundredths(d.loggedHours), 0n)),
      },
    };
  }

  /** One row per date: status, first in / last out, worked, late and early minutes, logged hours. */
  async daysOf(tx: TenantTransaction, employee: EmployeeRow, from: string, to: string) {
    const today = kuwaitToday();
    const shift = await this.shiftOf(tx, employee.membershipId);
    const events = await this.eventsBetween(tx, [employee.membershipId], from, to);
    const holidays = new Set(
      (
        await tx
          .select({ date: publicHolidays.date })
          .from(publicHolidays)
          .where(and(gte(publicHolidays.date, from), lte(publicHolidays.date, to)))
      ).map((h) => h.date),
    );
    const leave = await tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.membershipId, employee.membershipId),
          eq(leaveRequests.status, 'approved'),
          lte(leaveRequests.startDate, to),
          gte(leaveRequests.endDate, from),
        ),
      );
    const logged = await tx
      .select({ date: timeEntries.workDate, hours: timeEntries.hours })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.membershipId, employee.membershipId),
          gte(timeEntries.workDate, from),
          lte(timeEntries.workDate, to),
          ne(timeEntries.status, 'rejected'),
        ),
      );
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const mine = events.filter((e) => kuwaitDateOf(e.at) === d);
      const firstIn = mine.find((e) => e.kind === 'in');
      const lastOut = [...mine].reverse().find((e) => e.kind === 'out');
      let worked = 0;
      let open: Date | null = null;
      for (const e of mine) {
        if (e.kind === 'in' && !open) open = e.at;
        if (e.kind === 'out' && open) {
          worked += minutesBetween(open, e.at);
          open = null;
        }
      }
      if (shift && worked > shift.breakMinutes) worked -= shift.breakMinutes;
      const workday = employee.workDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay());
      const onLeave = leave.some((l) => l.startDate <= d && l.endDate >= d);
      let status:
        'present' | 'incomplete' | 'absent' | 'leave' | 'holiday' | 'weekend' | 'upcoming';
      if (mine.length > 0) status = open && d < today ? 'incomplete' : 'present';
      else if (onLeave) status = 'leave';
      else if (holidays.has(d)) status = 'holiday';
      else if (!workday) status = 'weekend';
      else if (d >= today) status = 'upcoming';
      else status = 'absent';
      let late = 0;
      let early = 0;
      if (shift && firstIn) {
        const minutesLate = minutesBetween(kuwaitInstant(d, shift.startTime), firstIn.at);
        late = minutesLate > shift.graceMinutes ? minutesLate : 0;
      }
      if (shift && lastOut)
        early = Math.max(0, minutesBetween(lastOut.at, kuwaitInstant(d, shift.endTime)));
      days.push({
        date: d,
        status,
        firstIn: firstIn?.at.toISOString() ?? null,
        lastOut: lastOut?.at.toISOString() ?? null,
        workedMinutes: Math.max(0, worked),
        lateMinutes: late,
        earlyMinutes: early,
        loggedHours: formatHours(
          logged.filter((l) => l.date === d).reduce((t, l) => t + hundredths(l.hours), 0n),
        ),
      });
    }
    return days;
  }

  /** "Who is in" for people I may see, today. */
  async today(access: AccessContext) {
    const date = kuwaitToday();
    const rows = await this.database.withTenant(access.tenantId, async (tx) => {
      const visible = await this.visible(tx, access);
      const staff = (await tx.select().from(employees).where(ne(employees.status, 'left'))).filter(
        (e) => !visible || visible.has(e.membershipId),
      );
      const ids = staff.map((s) => s.membershipId);
      if (ids.length === 0) return [];
      const events = await this.eventsBetween(tx, ids, date, date);
      const leave = await tx
        .select({ id: leaveRequests.membershipId })
        .from(leaveRequests)
        .where(
          and(
            inArray(leaveRequests.membershipId, ids),
            eq(leaveRequests.status, 'approved'),
            lte(leaveRequests.startDate, date),
            gte(leaveRequests.endDate, date),
          ),
        );
      const away = new Set(leave.map((l) => l.id));
      const assigned = await tx
        .select({ membershipId: shiftAssignments.membershipId, shift: shifts })
        .from(shiftAssignments)
        .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
        .where(inArray(shiftAssignments.membershipId, ids));
      return staff.map((s) => {
        const mine = events.filter((e) => e.membershipId === s.membershipId);
        const last = mine.at(-1);
        const first = mine.find((e) => e.kind === 'in');
        const shift = assigned.find((a) => a.membershipId === s.membershipId)?.shift;
        const workday = s.workDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
        const late =
          shift && first ? minutesBetween(kuwaitInstant(date, shift.startTime), first.at) : 0;
        return {
          membershipId: s.membershipId,
          state: last
            ? last.kind
            : away.has(s.membershipId)
              ? ('leave' as const)
              : workday
                ? ('not_in' as const)
                : ('off' as const),
          since: last?.at.toISOString() ?? null,
          lateMinutes: shift && late > shift.graceMinutes ? late : 0,
        };
      });
    });
    const names = await this.namesOf(
      access,
      rows.map((r) => r.membershipId),
    );
    return {
      date,
      items: rows
        .filter((r) => names.has(r.membershipId))
        .map((r) => ({ ...r, name: names.get(r.membershipId) ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  async dashboard(tx: TenantTransaction, access: AccessContext) {
    const date = kuwaitToday();
    const visible = await this.visible(tx, access);
    const events = (await this.eventsBetween(tx, null, date, date)).filter(
      (e) => !visible || visible.has(e.membershipId),
    );
    const last = new Map<string, EventRow>();
    for (const e of events) last.set(e.membershipId, e);
    const firsts = new Map<string, EventRow>();
    for (const e of events)
      if (e.kind === 'in' && !firsts.has(e.membershipId)) firsts.set(e.membershipId, e);
    const assigned = firsts.size
      ? await tx
          .select({ membershipId: shiftAssignments.membershipId, shift: shifts })
          .from(shiftAssignments)
          .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
          .where(inArray(shiftAssignments.membershipId, [...firsts.keys()]))
      : [];
    const lateToday = assigned.filter((a) => {
      const first = firsts.get(a.membershipId);
      return (
        first &&
        minutesBetween(kuwaitInstant(date, a.shift.startTime), first.at) > a.shift.graceMinutes
      );
    }).length;
    return { inNow: [...last.values()].filter((e) => e.kind === 'in').length, lateToday };
  }

  // --- corrections ---------------------------------------------------------------------------

  async requestCorrection(
    req: Request,
    access: AccessContext,
    input: { kind: 'in' | 'out'; at: string; reason: string },
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const employee = await this.employeeOf(tx, access.membershipId);
      const at = new Date(input.at);
      if (at.getTime() > Date.now()) throw invalid('at', 'future');
      if (Date.now() - at.getTime() > 31 * DAY) throw invalid('at', 'too_old');
      const [row] = await tx
        .insert(attendanceCorrections)
        .values({
          tenantId: access.tenantId,
          membershipId: access.membershipId,
          kind: input.kind,
          at,
          reason: input.reason,
        })
        .returning();
      if (!row) throw new Error('correction insert returned nothing');
      await this.record(
        tx,
        req,
        access,
        'attendance_correction',
        row.id,
        'attendance.correction.requested',
        { kind: input.kind },
      );
      await this.notifier.notify(tx, req, {
        tenantId: access.tenantId,
        type: 'attendance.correction_requested',
        recipients: await this.approversOf(tx, access, employee),
        params: {
          name: (await this.identity.userSummaries([access.userId]))[0]?.name ?? '',
          date: kuwaitDateOf(at),
        },
        link: '/attendance',
        actor: { userId: access.userId, membershipId: access.membershipId },
      });
      return this.toCorrection(tx, access, row);
    });
  }

  async corrections(access: AccessContext, view: 'mine' | 'approvals') {
    return this.database.withTenant(access.tenantId, async (tx) => {
      let rows;
      if (view === 'mine') {
        rows = await tx
          .select()
          .from(attendanceCorrections)
          .where(eq(attendanceCorrections.membershipId, access.membershipId))
          .orderBy(desc(attendanceCorrections.createdAt))
          .limit(100);
      } else {
        const pending = await tx
          .select()
          .from(attendanceCorrections)
          .where(
            and(
              eq(attendanceCorrections.status, 'pending'),
              ne(attendanceCorrections.membershipId, access.membershipId),
            ),
          )
          .orderBy(asc(attendanceCorrections.at));
        const scope = hasPermission(access.permissions, 'attendance.correction.approve', 'company')
          ? null
          : hasPermission(access.permissions, 'attendance.correction.approve', 'team')
            ? await teamScopeOf(tx, access.membershipId)
            : new Set<string>();
        rows = pending.filter((p) => !scope || scope.has(p.membershipId));
      }
      return { items: await Promise.all(rows.map((r) => this.toCorrection(tx, access, r))) };
    });
  }

  async decide(
    req: Request,
    access: AccessContext,
    id: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ) {
    return this.database.withTenant(access.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(attendanceCorrections)
        .where(eq(attendanceCorrections.id, id))
        .for('update');
      if (!row) throw notFound();
      if (!(await this.mayApprove(tx, access, row.membershipId))) {
        if (
          row.membershipId !== access.membershipId &&
          !(await this.canSee(tx, access, row.membershipId))
        )
          throw notFound();
        throw forbidden();
      }
      if (row.status !== 'pending')
        throw conflict('status', 'not_pending', 'This correction was already decided.');
      if (decision === 'rejected' && !note) throw invalid('note', 'required');
      const [updated] = await tx
        .update(attendanceCorrections)
        .set({
          status: decision,
          decidedByUserId: access.userId,
          decidedAt: new Date(),
          note: note ?? null,
        })
        .where(eq(attendanceCorrections.id, id))
        .returning();
      if (!updated) throw notFound();
      if (decision === 'approved') {
        await tx.insert(attendanceEvents).values({
          tenantId: access.tenantId,
          membershipId: row.membershipId,
          kind: row.kind,
          at: row.at,
          method: 'manual',
          correctionId: row.id,
        });
      }
      await this.record(
        tx,
        req,
        access,
        'attendance_correction',
        id,
        `attendance.correction.${decision}`,
        note ? { note } : undefined,
      );
      const [owner] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.id, row.membershipId));
      if (owner) {
        await this.notifier.notify(tx, req, {
          tenantId: access.tenantId,
          type: 'attendance.correction_decided',
          recipients: [owner.userId],
          params: { status: decision, date: kuwaitDateOf(row.at) },
          link: '/attendance',
          actor: { userId: access.userId, membershipId: access.membershipId },
        });
      }
      return this.toCorrection(tx, access, updated);
    });
  }

  // --- helpers -------------------------------------------------------------------------------

  private async eventsBetween(
    tx: TenantTransaction,
    membershipIds: string[] | null,
    from: string,
    to: string,
  ) {
    const start = kuwaitInstant(from, '00:00:00');
    const end = new Date(kuwaitInstant(to, '00:00:00').getTime() + DAY);
    return tx
      .select()
      .from(attendanceEvents)
      .where(
        and(
          membershipIds ? inArray(attendanceEvents.membershipId, membershipIds) : undefined,
          gte(attendanceEvents.at, start),
          lte(attendanceEvents.at, end),
        ),
      )
      .orderBy(asc(attendanceEvents.at));
  }

  private async shiftOf(
    tx: TenantTransaction,
    membershipId: string,
  ): Promise<ShiftRow | undefined> {
    const [row] = await tx
      .select({ shift: shifts })
      .from(shiftAssignments)
      .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .where(eq(shiftAssignments.membershipId, membershipId));
    return row?.shift;
  }

  private async employeeOf(tx: TenantTransaction, membershipId: string, lock = false) {
    const query = tx.select().from(employees).where(eq(employees.membershipId, membershipId));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw invalid('membershipId', 'no_employee_record');
    return row;
  }

  private async visible(tx: TenantTransaction, access: AccessContext): Promise<Set<string> | null> {
    if (hasPermission(access.permissions, 'attendance.read', 'company')) return null;
    const set = hasPermission(access.permissions, 'attendance.read', 'team')
      ? await teamScopeOf(tx, access.membershipId)
      : new Set<string>();
    set.add(access.membershipId);
    return set;
  }

  private async canSee(tx: TenantTransaction, access: AccessContext, membershipId: string) {
    const v = await this.visible(tx, access);
    return !v || v.has(membershipId);
  }

  private async mayApprove(tx: TenantTransaction, access: AccessContext, membershipId: string) {
    if (membershipId === access.membershipId) return false;
    if (hasPermission(access.permissions, 'attendance.correction.approve', 'company')) return true;
    return (
      hasPermission(access.permissions, 'attendance.correction.approve', 'team') &&
      (await teamScopeOf(tx, access.membershipId)).has(membershipId)
    );
  }

  /** Direct manager and team leads; Owner/CEO/HR when there is none. */
  private async approversOf(tx: TenantTransaction, access: AccessContext, employee: EmployeeRow) {
    const leads = await tx
      .select({ id: teams.leadMembershipId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teamMembers.membershipId, employee.membershipId), isNull(teams.archivedAt)));
    let ids = [
      ...new Set(
        [employee.managerMembershipId, ...leads.map((l) => l.id)].filter(
          (x): x is string => Boolean(x) && x !== access.membershipId,
        ),
      ),
    ];
    if (ids.length === 0) {
      ids = (
        await tx
          .selectDistinct({ id: memberships.id })
          .from(memberships)
          .innerJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
          .where(
            and(
              eq(memberships.status, 'active'),
              inArray(membershipRoles.role, ['owner', 'ceo', 'hr_payroll']),
            ),
          )
      )
        .map((r) => r.id)
        .filter((id) => id !== access.membershipId);
    }
    if (ids.length === 0) return [];
    return (
      await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(inArray(memberships.id, ids), eq(memberships.status, 'active')))
    ).map((u) => u.userId);
  }

  private async toCorrection(
    tx: TenantTransaction,
    access: AccessContext,
    r: typeof attendanceCorrections.$inferSelect,
  ) {
    const names = await this.namesOf(access, [r.membershipId], tx);
    const decider = r.decidedByUserId
      ? ((await this.identity.userSummaries([r.decidedByUserId]))[0]?.name ?? null)
      : null;
    const approver = r.status === 'pending' && (await this.mayApprove(tx, access, r.membershipId));
    return {
      id: r.id,
      person: { membershipId: r.membershipId, name: names.get(r.membershipId) ?? '' },
      kind: r.kind,
      at: r.at.toISOString(),
      reason: r.reason,
      status: r.status,
      decidedByName: decider,
      note: r.note,
      actions: approver ? (['approve', 'reject'] as ('approve' | 'reject')[]) : [],
    };
  }

  private async namesOf(access: AccessContext, membershipIds: string[], tx?: TenantTransaction) {
    const unique = [...new Set(membershipIds)];
    if (unique.length === 0) return new Map<string, string>();
    const load = (t: TenantTransaction) =>
      t
        .select({ id: memberships.id, userId: memberships.userId })
        .from(memberships)
        .where(inArray(memberships.id, unique));
    const rows = tx ? await load(tx) : await this.database.withTenant(access.tenantId, load);
    const users = new Map(
      (await this.identity.userSummaries(rows.map((r) => r.userId))).map((u) => [u.id, u.name]),
    );
    return new Map(
      rows.flatMap((r) =>
        users.has(r.userId) ? [[r.id, users.get(r.userId) ?? ''] as const] : [],
      ),
    );
  }

  private record(
    tx: TenantTransaction,
    req: Request,
    access: AccessContext,
    type: string,
    id: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    return this.audit.record(tx, req, {
      tenantId: access.tenantId,
      action,
      actor: { userId: access.userId, membershipId: access.membershipId },
      target: { type, id },
      ...(details ? { details } : {}),
    });
  }
}
