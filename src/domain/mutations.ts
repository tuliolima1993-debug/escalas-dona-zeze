/**
 * Operações de edição da escala sobre um Snapshot (puras: recebem e devolvem um snapshot novo).
 * Usadas pelo modo demonstração e pelos testes; o banco Supabase aplica as mesmas regras
 * por meio de constraints, triggers e funções RPC (ver supabase/migrations).
 */
import { hasSkill } from './eligibility';
import { saturdaysOfMonth } from './dates';
import type { Assignment, Attendance, ISODate, Requirement, ScheduleStatus, Snapshot, WorkDay } from './types';

export class DomainError extends Error {}

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

const clone = <T,>(x: T): T => structuredClone(x);

export interface MemberInput {
  employeeId: string | null;
  activityId: string | null;
  reservedLabel: string | null;
  requiredSkillId: string | null;
}

export interface CommitDay {
  date: ISODate;
  startTime: string;
  endTime: string;
  members: MemberInput[];
}

export interface CommitPayload {
  year: number;
  month: number;
  days: CommitDay[];
}

function ensureSchedule(s: Snapshot, year: number, month: number) {
  let sc = s.schedules.find((x) => x.year === year && x.month === month);
  if (!sc) {
    sc = { id: uid(), year, month, status: 'draft', publishedAt: null, updatedAt: new Date().toISOString() };
    s.schedules.push(sc);
  }
  if (sc.status === 'closed') throw new DomainError('Esta escala está encerrada e não pode ser alterada.');
  return sc;
}

export function ensureWorkDay(s: Snapshot, date: ISODate): WorkDay {
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  const existing = s.workDays.find((w) => w.date === date);
  if (existing) return existing;
  if (!saturdaysOfMonth(year, month).includes(date)) throw new DomainError('A data informada não é um sábado. Cadastre-a como data extra.');
  const sc = ensureSchedule(s, year, month);
  let wd = s.workDays.find((w) => w.scheduleId === sc.id && w.date === date);
  if (!wd) {
    wd = { id: uid(), scheduleId: sc.id, date, startTime: s.settings.startTime, endTime: s.settings.endTime, locked: false, note: null };
    s.workDays.push(wd);
  }
  return wd;
}

const activeOn = (s: Snapshot, workDayId: string) =>
  s.assignments.filter((a) => a.workDayId === workDayId && a.status === 'active');

function scheduleOfDay(s: Snapshot, wd: WorkDay) {
  return s.schedules.find((x) => x.id === wd.scheduleId)!;
}

function assertEditable(s: Snapshot, wd: WorkDay, opts: { allowLocked?: boolean } = {}) {
  if (scheduleOfDay(s, wd).status === 'closed') throw new DomainError('Esta escala está encerrada e não pode ser alterada.');
  if (wd.locked && !opts.allowLocked) throw new DomainError('Este sábado está bloqueado. Desbloqueie para alterar.');
}

function assertMember(s: Snapshot, wd: WorkDay, m: MemberInput, ignoreId?: string) {
  if (m.employeeId) {
    const e = s.employees.find((x) => x.id === m.employeeId);
    if (!e) throw new DomainError('Colaborador não encontrado.');
    if (activeOn(s, wd.id).some((a) => a.employeeId === m.employeeId && a.id !== ignoreId))
      throw new DomainError(`${e.shortName} já está escalado(a) neste sábado.`);
    if (m.activityId && !hasSkill(e, m.activityId)) throw new DomainError(`${e.shortName} não está habilitado(a) para a atividade escolhida.`);
    if (m.requiredSkillId && !hasSkill(e, m.requiredSkillId)) throw new DomainError(`A vaga exige uma habilidade que ${e.shortName} não possui.`);
  }
}

function assertCapacity(s: Snapshot, wd: WorkDay, adding = 1) {
  if (activeOn(s, wd.id).length + adding > s.settings.maxPerDay)
    throw new DomainError(`Limite de transporte atingido (${s.settings.maxPerDay} pessoas por sábado).`);
}

const touch = (s: Snapshot, wd: WorkDay) => {
  scheduleOfDay(s, wd).updatedAt = new Date().toISOString();
};

/** Participações que contam na cota de uma pessoa no mês da escala. */
export function quotaUsed(s: Snapshot, scheduleId: string, employeeId: string, excludeId?: string) {
  const days = new Set(s.workDays.filter((w) => w.scheduleId === scheduleId && w.countsInQuota !== false).map((w) => w.id));
  return s.assignments.filter((a) => a.status === 'active' && a.employeeId === employeeId && days.has(a.workDayId) && a.id !== excludeId).length;
}

function assertQuota(s: Snapshot, wd: WorkDay, employeeId: string | null, excludeId?: string) {
  if (!employeeId || wd.countsInQuota === false) return;
  const sc = scheduleOfDay(s, wd);
  if (!sc.useQuotas) return;
  const q = s.quotas?.find((x) => x.scheduleId === sc.id && x.employeeId === employeeId)?.quota ?? 0;
  const used = quotaUsed(s, sc.id, employeeId, excludeId);
  if (used + 1 > q) {
    const name = s.employees.find((e) => e.id === employeeId)?.shortName ?? 'Colaborador';
    throw new DomainError(`Cota de ${name} esgotada (${used} de ${q}). Aumente a cota ou mova uma participação existente.`);
  }
}

/** Salva a prévia confirmada: substitui as participações ativas dos sábados enviados (nunca de sábados bloqueados). */
export function commitMonth(prev: Snapshot, p: CommitPayload): Snapshot {
  const s = clone(prev);
  ensureSchedule(s, p.year, p.month);
  for (const d of p.days) {
    const wd = ensureWorkDay(s, d.date);
    if (wd.locked) throw new DomainError(`O sábado ${d.date} está bloqueado e não pode ser regerado.`);
    if (d.members.length > s.settings.maxPerDay) throw new DomainError(`Limite de transporte excedido em ${d.date}.`);
    s.assignments = s.assignments.filter((a) => !(a.workDayId === wd.id && a.status === 'active'));
    wd.startTime = d.startTime;
    wd.endTime = d.endTime;
    d.members.forEach((m, i) => {
      assertMember(s, wd, m);
      assertQuota(s, wd, m.employeeId);
      s.assignments.push({ id: uid(), workDayId: wd.id, ...m, status: 'active', attendance: null, replacedById: null, position: i, createdAt: new Date().toISOString() });
    });
    touch(s, wd);
  }
  return s;
}

export function addAssignment(prev: Snapshot, date: ISODate, m: MemberInput): Snapshot {
  const s = clone(prev);
  const wd = ensureWorkDay(s, date);
  assertEditable(s, wd);
  assertCapacity(s, wd);
  assertMember(s, wd, m);
  assertQuota(s, wd, m.employeeId);
  s.assignments.push({ id: uid(), workDayId: wd.id, ...m, status: 'active', attendance: null, replacedById: null, position: activeOn(s, wd.id).length, createdAt: new Date().toISOString() });
  touch(s, wd);
  return s;
}

export function updateAssignment(
  prev: Snapshot,
  id: string,
  patch: Partial<Pick<Assignment, 'employeeId' | 'activityId' | 'reservedLabel' | 'requiredSkillId' | 'attendance'>>,
): Snapshot {
  const s = clone(prev);
  const a = s.assignments.find((x) => x.id === id);
  if (!a) throw new DomainError('Participação não encontrada.');
  const wd = s.workDays.find((w) => w.id === a.workDayId)!;
  const onlyAttendance = Object.keys(patch).every((k) => k === 'attendance');
  if (!onlyAttendance) assertEditable(s, wd);
  else if (scheduleOfDay(s, wd).status === 'closed') throw new DomainError('Esta escala está encerrada e não pode ser alterada.');
  const next = { ...a, ...patch };
  if (!onlyAttendance) assertMember(s, wd, next, a.id);
  if ('employeeId' in patch && patch.employeeId !== a.employeeId) assertQuota(s, wd, patch.employeeId ?? null, a.id);
  Object.assign(a, patch);
  touch(s, wd);
  return s;
}

export function setAttendance(prev: Snapshot, id: string, attendance: Attendance) {
  return updateAssignment(prev, id, { attendance });
}

export function removeAssignment(prev: Snapshot, id: string): Snapshot {
  const s = clone(prev);
  const a = s.assignments.find((x) => x.id === id);
  if (!a) throw new DomainError('Participação não encontrada.');
  const wd = s.workDays.find((w) => w.id === a.workDayId)!;
  assertEditable(s, wd);
  s.assignments = s.assignments.filter((x) => x.id !== id);
  touch(s, wd);
  return s;
}

/** Substituição: a participação original fica registrada como "substituída" e aponta para a nova. */
export function replaceAssignment(prev: Snapshot, id: string, newEmployeeId: string, activityId: string | null): Snapshot {
  const s = clone(prev);
  const a = s.assignments.find((x) => x.id === id && x.status === 'active');
  if (!a) throw new DomainError('Participação não encontrada.');
  const wd = s.workDays.find((w) => w.id === a.workDayId)!;
  assertEditable(s, wd, { allowLocked: true }); // substituir em dia bloqueado é permitido (ex.: ausência)
  const m: MemberInput = { employeeId: newEmployeeId, activityId, reservedLabel: a.reservedLabel, requiredSkillId: a.requiredSkillId };
  assertMember(s, wd, m, a.id);
  assertQuota(s, wd, newEmployeeId, a.id);
  const newId = uid();
  if (a.employeeId) {
    a.status = 'replaced';
    a.replacedById = newId;
  } else {
    s.assignments = s.assignments.filter((x) => x.id !== a.id); // vaga reservada: apenas preenchida
  }
  s.assignments.push({ id: newId, workDayId: wd.id, ...m, status: 'active', attendance: null, replacedById: null, position: a.position, createdAt: new Date().toISOString() });
  touch(s, wd);
  return s;
}

/** Troca duas pessoas entre sábados diferentes (cada uma assume a atividade da outra se habilitada). */
export function swapAssignments(prev: Snapshot, aId: string, bId: string): Snapshot {
  const s = clone(prev);
  const a = s.assignments.find((x) => x.id === aId && x.status === 'active');
  const b = s.assignments.find((x) => x.id === bId && x.status === 'active');
  if (!a || !b) throw new DomainError('Participação não encontrada.');
  if (a.workDayId === b.workDayId) throw new DomainError('As duas pessoas já estão no mesmo sábado.');
  const wa = s.workDays.find((w) => w.id === a.workDayId)!;
  const wb = s.workDays.find((w) => w.id === b.workDayId)!;
  assertEditable(s, wa);
  assertEditable(s, wb);
  const ea = s.employees.find((e) => e.id === a.employeeId);
  const eb = s.employees.find((e) => e.id === b.employeeId);
  // Cada pessoa mantém a própria atividade quando possível; vagas obrigatórias são revalidadas depois.
  const fit = (e: typeof ea, own: string | null, other: string | null) => (e && other && hasSkill(e, other) ? other : own);
  const actA = fit(eb, b.activityId, a.activityId); // atividade de B ao ir para o dia de A
  const actB = fit(ea, a.activityId, b.activityId);
  const tmp = { e: a.employeeId, r: a.reservedLabel, q: a.requiredSkillId };
  a.employeeId = b.employeeId; a.reservedLabel = b.reservedLabel; a.requiredSkillId = b.requiredSkillId; a.activityId = actA; a.attendance = null;
  b.employeeId = tmp.e; b.reservedLabel = tmp.r; b.requiredSkillId = tmp.q; b.activityId = actB; b.attendance = null;
  assertMember(s, wa, a, a.id);
  assertMember(s, wb, b, b.id);
  if ((wa.countsInQuota !== false) !== (wb.countsInQuota !== false)) {
    assertQuota(s, wa, a.employeeId, a.id);
    assertQuota(s, wb, b.employeeId, b.id);
  }
  touch(s, wa);
  touch(s, wb);
  return s;
}

/** Move uma participação para outro sábado (arrastar e soltar sobre o cartão). */
export function moveAssignment(prev: Snapshot, id: string, targetDate: ISODate): Snapshot {
  const s = clone(prev);
  const a = s.assignments.find((x) => x.id === id && x.status === 'active');
  if (!a) throw new DomainError('Participação não encontrada.');
  const from = s.workDays.find((w) => w.id === a.workDayId)!;
  assertEditable(s, from);
  const to = ensureWorkDay(s, targetDate);
  if (to.id === from.id) return prev;
  assertEditable(s, to);
  assertCapacity(s, to);
  assertMember(s, to, a, a.id);
  if (from.countsInQuota === false && to.countsInQuota !== false) assertQuota(s, to, a.employeeId, a.id);
  a.workDayId = to.id;
  a.attendance = null;
  a.position = activeOn(s, to.id).length;
  touch(s, from);
  return s;
}

export function setDayLocked(prev: Snapshot, date: ISODate, locked: boolean): Snapshot {
  const s = clone(prev);
  const wd = ensureWorkDay(s, date);
  if (scheduleOfDay(s, wd).status === 'closed') throw new DomainError('Escala encerrada.');
  wd.locked = locked;
  return s;
}

export function updateWorkDay(prev: Snapshot, date: ISODate, patch: Partial<Pick<WorkDay, 'startTime' | 'endTime' | 'note'>>): Snapshot {
  const s = clone(prev);
  const wd = ensureWorkDay(s, date);
  assertEditable(s, wd);
  Object.assign(wd, patch);
  return s;
}

export function setScheduleStatus(prev: Snapshot, year: number, month: number, status: ScheduleStatus): Snapshot {
  const s = clone(prev);
  const sc = s.schedules.find((x) => x.year === year && x.month === month);
  if (!sc) throw new DomainError('Gere a escala antes de alterar a situação.');
  if (status === 'published' && sc.status === 'draft') {
    const problems: string[] = [];
    for (const wd of s.workDays.filter((w) => w.scheduleId === sc.id)) {
      const act = activeOn(s, wd.id);
      if (act.length > s.settings.maxPerDay) problems.push(`${wd.date}: acima do limite de transporte`);
      const reqs = wd.kind === 'extra' ? wd.requirements ?? [] : s.requirements;
      for (const r of reqs.filter((x) => x.mandatory && x.minCount > 0)) {
        const n = act.filter((a) => a.employeeId && a.activityId === r.skillId).length;
        if (n < r.minCount) problems.push(`${wd.date.split('-').reverse().slice(0, 2).join('/')}: ${s.skills.find((k) => k.id === r.skillId)?.name} com ${n} de ${r.minCount}`);
      }
    }
    if (problems.length) throw new DomainError(`A escala não pode ser publicada: ${problems.join('; ')}`);
  }
  sc.status = status;
  if (status === 'published') sc.publishedAt = new Date().toISOString();
  if (status === 'closed') s.workDays.filter((w) => w.scheduleId === sc.id).forEach((w) => (w.locked = true));
  sc.updatedAt = new Date().toISOString();
  return s;
}

export interface ExtraDayInput {
  date: ISODate;
  label: string;
  startTime: string;
  endTime: string;
  idealSize: number;
  countsInQuota: boolean;
  requirements: Requirement[];
}

/** Cria ou edita uma data extraordinária (feriado, rega, manutenção…). */
export function saveExtraDay(prev: Snapshot, x: ExtraDayInput): Snapshot {
  const s = clone(prev);
  if (x.endTime <= x.startTime) throw new DomainError('O horário de encerramento deve ser após o início.');
  const existing = s.workDays.find((w) => w.date === x.date);
  if (existing && existing.kind !== 'extra') throw new DomainError('Esta data já é um sábado regular da escala.');
  const sc = ensureSchedule(s, Number(x.date.slice(0, 4)), Number(x.date.slice(5, 7)));
  const fields = {
    startTime: x.startTime, endTime: x.endTime, label: x.label.trim() || null, countsInQuota: x.countsInQuota,
    idealSize: x.idealSize, requirements: x.requirements, kind: 'extra' as const,
  };
  if (existing) Object.assign(existing, fields);
  else s.workDays.push({ id: uid(), scheduleId: sc.id, date: x.date, locked: false, note: null, ...fields });
  return s;
}

export function removeExtraDay(prev: Snapshot, date: ISODate): Snapshot {
  const s = clone(prev);
  const wd = s.workDays.find((w) => w.date === date && w.kind === 'extra');
  if (!wd) throw new DomainError('Data extra não encontrada.');
  if (scheduleOfDay(s, wd).status === 'closed') throw new DomainError('Escala encerrada.');
  s.assignments = s.assignments.filter((a) => a.workDayId !== wd.id);
  s.workDays = s.workDays.filter((w) => w.id !== wd.id);
  return s;
}

/** Define as cotas do mês. Nunca abaixo do que já foi colocado na escala. */
export function setQuotas(prev: Snapshot, year: number, month: number, quotas: Record<string, number>, enable: boolean): Snapshot {
  const s = clone(prev);
  const sc = ensureSchedule(s, year, month);
  s.quotas ??= [];
  for (const [employeeId, quota] of Object.entries(quotas)) {
    if (quota < 0 || quota > 10) throw new DomainError('Cota inválida.');
    const used = quotaUsed(s, sc.id, employeeId);
    if (enable && quota < used) {
      const name = s.employees.find((e) => e.id === employeeId)?.shortName ?? 'Colaborador';
      throw new DomainError(`A cota de ${name} não pode ser menor que as ${used} participação(ões) já colocadas. Remova ou mova antes.`);
    }
    const q = s.quotas.find((x) => x.scheduleId === sc.id && x.employeeId === employeeId);
    if (q) q.quota = quota;
    else s.quotas.push({ scheduleId: sc.id, employeeId, quota });
  }
  sc.useQuotas = enable;
  return s;
}
