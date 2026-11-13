import { hoursBetween, monthKey, saturdaysOfMonth, weeksBetween } from './dates';
import { countActivities, dayIdeal, type DayView } from './validate';
import type { PastParticipation } from './scheduler';
import type { Assignment, Employee, ISODate, Schedule, Snapshot, WorkDay } from './types';

export const activeAssignments = (s: Pick<Snapshot, 'assignments'>) => s.assignments.filter((a) => a.status === 'active');

export function findSchedule(s: Pick<Snapshot, 'schedules'>, year: number, month: number): Schedule | undefined {
  return s.schedules.find((x) => x.year === year && x.month === month);
}

export function dayViewsFor(s: Snapshot, year: number, month: number): (DayView & { workDay?: WorkDay })[] {
  const schedule = findSchedule(s, year, month);
  const wds = schedule ? s.workDays.filter((w) => w.scheduleId === schedule.id) : [];
  const dates = Array.from(new Set([...saturdaysOfMonth(year, month), ...wds.map((w) => w.date)])).sort();
  return dates.map((date) => {
    const wd = wds.find((w) => w.date === date);
    const members = wd
      ? activeAssignments(s)
          .filter((a) => a.workDayId === wd.id)
          .sort((a, b) => a.position - b.position)
          .map((a) => ({ key: a.id, employeeId: a.employeeId, activityId: a.activityId, reservedLabel: a.reservedLabel, requiredSkillId: a.requiredSkillId }))
      : [];
    return {
      date,
      startTime: wd?.startTime ?? s.settings.startTime,
      endTime: wd?.endTime ?? s.settings.endTime,
      locked: wd?.locked ?? false,
      members,
      workDay: wd,
      kind: wd?.kind ?? 'regular',
      label: wd?.label ?? null,
      countsInQuota: wd?.countsInQuota ?? true,
      idealSize: wd?.idealSize ?? null,
      requirements: wd?.kind === 'extra' ? wd.requirements ?? [] : null,
    };
  });
}

/** Cotas do mês, se o banco de cotas estiver ativo. */
export function quotasFor(s: Snapshot, year: number, month: number): Record<string, number> | undefined {
  const sc = findSchedule(s, year, month);
  if (!sc?.useQuotas) return undefined;
  const out: Record<string, number> = {};
  for (const q of s.quotas ?? []) if (q.scheduleId === sc.id) out[q.employeeId] = q.quota;
  return out;
}

/** Participações que contam na cota, por pessoa, no mês. */
export function quotaUsage(s: Snapshot, year: number, month: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dayViewsFor(s, year, month)) {
    if (d.countsInQuota === false) continue;
    for (const m of d.members) if (m.employeeId) out[m.employeeId] = (out[m.employeeId] ?? 0) + 1;
  }
  return out;
}

const dateOfWorkDay = (s: Snapshot) => {
  const m = new Map(s.workDays.map((w) => [w.id, w]));
  return (a: Assignment) => m.get(a.workDayId);
};

/** Participações efetivas (escalado e não ausente) antes de uma data, opcionalmente limitadas aos últimos N meses. */
export function pastParticipations(s: Snapshot, before: ISODate, windowMonths = 0): PastParticipation[] {
  const wdOf = dateOfWorkDay(s);
  let from = '0000-00-00';
  if (windowMonths > 0) {
    const [y, m] = before.split('-').map(Number);
    const d = new Date(y, m - 1 - windowMonths, 1);
    from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  return activeAssignments(s)
    .filter((a) => a.employeeId && a.attendance !== 'absent')
    .map((a) => ({ employeeId: a.employeeId!, date: wdOf(a)?.date ?? '' }))
    .filter((p) => p.date && p.date < before && p.date >= from);
}

export interface EmployeeStats {
  employee: Employee;
  scheduledMonth: number;
  presentMonth: number;
  absentMonth: number;
  replacedMonth: number;
  scheduledYear: number;
  presentYear: number;
  absentYear: number;
  replacedYear: number;
  hoursWorkedYear: number;
  hoursScheduledYear: number;
  lastWorked: ISODate | null;
  maxConsecutive: number;
  byMonth: number[]; // 12 posições: escalado por mês no ano
}

export function employeeStats(s: Snapshot, year: number, month: number): EmployeeStats[] {
  const wdOf = dateOfWorkDay(s);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return s.employees.map((e) => {
    const mine = s.assignments.filter((a) => a.employeeId === e.id).map((a) => ({ a, wd: wdOf(a) })).filter((x) => x.wd);
    const inYear = mine.filter((x) => x.wd!.date.startsWith(`${year}-`));
    const inMonth = inYear.filter((x) => monthKey(x.wd!.date) === ym);
    const act = (xs: typeof mine) => xs.filter((x) => x.a.status === 'active');
    const byMonth = Array.from({ length: 12 }, (_, i) =>
      act(inYear).filter((x) => Number(x.wd!.date.slice(5, 7)) === i + 1).length,
    );
    const worked = act(mine).filter((x) => x.a.attendance !== 'absent').map((x) => x.wd!.date).sort();
    const today = new Date().toISOString().slice(0, 10);
    const past = worked.filter((d) => d <= today);
    let maxConsecutive = worked.length ? 1 : 0, run = 1;
    for (let i = 1; i < worked.length; i++) {
      run = weeksBetween(worked[i - 1], worked[i]) === 1 ? run + 1 : 1;
      maxConsecutive = Math.max(maxConsecutive, run);
    }
    const hours = (xs: typeof mine) => xs.reduce((h, x) => h + hoursBetween(x.wd!.startTime, x.wd!.endTime), 0);
    return {
      employee: e,
      scheduledMonth: act(inMonth).length,
      presentMonth: act(inMonth).filter((x) => x.a.attendance === 'present').length,
      absentMonth: act(inMonth).filter((x) => x.a.attendance === 'absent').length,
      replacedMonth: inMonth.filter((x) => x.a.status === 'replaced').length,
      scheduledYear: act(inYear).length,
      presentYear: act(inYear).filter((x) => x.a.attendance === 'present').length,
      absentYear: act(inYear).filter((x) => x.a.attendance === 'absent').length,
      replacedYear: inYear.filter((x) => x.a.status === 'replaced').length,
      hoursWorkedYear: hours(act(inYear).filter((x) => x.a.attendance === 'present')),
      hoursScheduledYear: hours(act(inYear)),
      lastWorked: past.length ? past[past.length - 1] : null,
      maxConsecutive,
      byMonth,
    };
  });
}

export interface DashboardKpis {
  activeEmployees: number;
  saturdays: number;
  extraDays: number;
  capacity: number;
  filled: number;
  pending: number;
  reserved: number;
  cloningCovered: number;
  distribution: { min: number; max: number; avg: number };
}

export function dashboardKpis(s: Snapshot, year: number, month: number, cloningSkillIds: string[]): DashboardKpis {
  const all = dayViewsFor(s, year, month);
  const days = all.filter((d) => d.kind !== 'extra');
  const active = s.employees.filter((e) => e.status === 'active');
  const filled = all.reduce((n, d) => n + d.members.filter((m) => m.employeeId).length, 0);
  const reserved = all.reduce((n, d) => n + d.members.filter((m) => !m.employeeId).length, 0);
  const capacity = all.reduce((n, d) => n + dayIdeal(d, s.settings), 0);
  const cloningCovered = days.filter((d) => {
    const c = countActivities(d);
    return cloningSkillIds.every((id) => {
      const req = s.requirements.find((r) => r.skillId === id);
      return (c[id]?.confirmed ?? 0) >= Math.max(1, req?.minCount ?? 1);
    });
  }).length;
  const counts = active.map((e) => all.filter((d) => d.countsInQuota !== false && d.members.some((m) => m.employeeId === e.id)).length);
  return {
    activeEmployees: active.length,
    saturdays: days.length,
    extraDays: all.length - days.length,
    capacity,
    filled,
    reserved,
    pending: Math.max(0, capacity - filled),
    cloningCovered,
    distribution: counts.length
      ? { min: Math.min(...counts), max: Math.max(...counts), avg: counts.reduce((a, b) => a + b, 0) / counts.length }
      : { min: 0, max: 0, avg: 0 },
  };
}

/** Último sábado trabalhado antes do mês, por pessoa. */
export function lastWorkedBefore(s: Snapshot, before: ISODate): Record<string, ISODate> {
  const out: Record<string, ISODate> = {};
  for (const p of pastParticipations(s, before)) if (!out[p.employeeId] || p.date > out[p.employeeId]) out[p.employeeId] = p.date;
  return out;
}
