import { checkAvailability, capFor, hasSkill } from './eligibility';
import { fmtShort, weeksBetween } from './dates';
import type { DayKind, Employee, ISODate, Requirement, Settings, Skill, Unavailability } from './types';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  code: string;
  date?: ISODate;
  employeeId?: string;
  message: string;
  suggestions?: string[];
}

/** Forma neutra de um sábado, usada tanto na prévia quanto na escala salva. */
export interface DayMember {
  key: string; // id da participação (ou chave temporária na prévia)
  employeeId: string | null;
  activityId: string | null;
  reservedLabel: string | null;
  requiredSkillId: string | null;
}

export interface DayView {
  date: ISODate;
  startTime: string;
  endTime: string;
  locked: boolean;
  members: DayMember[];
  kind?: DayKind;
  label?: string | null;
  countsInQuota?: boolean;
  idealSize?: number | null;
  requirements?: Requirement[] | null;
}

export const isExtra = (d: Pick<DayView, 'kind'>) => d.kind === 'extra';
export const dayIdeal = (d: Pick<DayView, 'idealSize'>, settings: Pick<Settings, 'idealPerDay' | 'maxPerDay'>) =>
  Math.min(d.idealSize ?? settings.idealPerDay, settings.maxPerDay);
export const dayRequirements = (d: Pick<DayView, 'requirements'>, global: Requirement[]) => d.requirements ?? global;

export interface ValidationContext {
  employees: Employee[];
  skills: Skill[];
  unavailability: Unavailability[];
  requirements: Requirement[];
  settings: Pick<Settings, 'maxPerDay' | 'idealPerDay' | 'maxPerMonth' | 'avoidConsecutive' | 'startTime' | 'endTime'>;
  /** Último sábado trabalhado antes do mês, por pessoa (para checar sábados consecutivos na virada do mês). */
  lastWorkedBefore?: Record<string, ISODate | undefined>;
  /** Cotas do mês (banco de cotas ativo): passa a ser o limite individual. */
  quotas?: Record<string, number>;
  /** Datas anteriores a "today" são históricas: a situação atual (férias, inativo) não as invalida. */
  today?: ISODate;
}

export interface ActivityCount {
  skillId: string;
  confirmed: number;
  pending: number;
}

/** Conta pessoas por atividade efetivamente atribuída — cada pessoa conta uma única vez. */
export function countActivities(day: DayView): Record<string, ActivityCount> {
  const out: Record<string, ActivityCount> = {};
  for (const m of day.members) {
    const sid = m.activityId ?? m.requiredSkillId;
    if (!sid) continue;
    out[sid] ??= { skillId: sid, confirmed: 0, pending: 0 };
    if (m.employeeId) out[sid].confirmed += 1;
    else out[sid].pending += 1;
  }
  return out;
}

export const confirmedCount = (day: DayView) => day.members.filter((m) => m.employeeId).length;
export const pendingCount = (day: DayView) => day.members.filter((m) => !m.employeeId).length;

export function validateMonth(days: DayView[], ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const skillName = (id: string | null) => ctx.skills.find((s) => s.id === id)?.name ?? 'atividade';
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const monthCount = new Map<string, number>();
  const lastWorked = new Map<string, ISODate>(
    Object.entries(ctx.lastWorkedBefore ?? {}).filter((e): e is [string, ISODate] => !!e[1]),
  );

  for (const day of sorted) {
    const d = fmtShort(day.date);
    const total = day.members.length;
    const seen = new Set<string>();

    // Capacidade de transporte (obrigatória). Vagas reservadas ocupam lugar no transporte.
    if (total > ctx.settings.maxPerDay) {
      issues.push({
        severity: 'error', code: 'capacity', date: day.date,
        message: `${d}: ${total} pessoas escaladas, acima do limite de transporte (${ctx.settings.maxPerDay}).`,
        suggestions: ['Remova ou mova alguém para outro sábado.', 'Aumente o limite de transporte em Configurações, se houver veículo extra.'],
      });
    }

    for (const m of day.members) {
      if (!m.employeeId) continue;
      const e = empById.get(m.employeeId);
      if (!e) {
        issues.push({ severity: 'error', code: 'unknown', date: day.date, message: `${d}: colaborador não encontrado.` });
        continue;
      }
      if (seen.has(e.id)) {
        issues.push({ severity: 'error', code: 'duplicate', date: day.date, employeeId: e.id, message: `${d}: ${e.shortName} aparece duas vezes no mesmo sábado.` });
      }
      seen.add(e.id);
      const av = checkAvailability(e, day.date, ctx.unavailability);
      if (!av.ok && !(ctx.today && day.date < ctx.today)) {
        issues.push({
          severity: 'error', code: 'unavailable', date: day.date, employeeId: e.id,
          message: `${d}: ${e.shortName} está ${av.reason}.`,
          suggestions: [`Substitua ${e.shortName} por alguém disponível.`],
        });
      }
      if (m.activityId && !hasSkill(e, m.activityId)) {
        issues.push({
          severity: 'error', code: 'skill', date: day.date, employeeId: e.id,
          message: `${d}: ${e.shortName} não está habilitado(a) para ${skillName(m.activityId)}.`,
          suggestions: ['Altere a atividade atribuída ou cadastre a habilidade no colaborador.'],
        });
      }
      if (m.requiredSkillId && !hasSkill(e, m.requiredSkillId)) {
        issues.push({
          severity: 'error', code: 'reserved-skill', date: day.date, employeeId: e.id,
          message: `${d}: a vaga exige ${skillName(m.requiredSkillId)}, mas ${e.shortName} não possui essa habilidade.`,
        });
      }
      if (day.countsInQuota !== false) monthCount.set(e.id, (monthCount.get(e.id) ?? 0) + 1);
      const prev = lastWorked.get(e.id);
      if (!isExtra(day) && ctx.settings.avoidConsecutive && prev && weeksBetween(prev, day.date) === 1) {
        issues.push({
          severity: 'warning', code: 'consecutive', date: day.date, employeeId: e.id,
          message: `${d}: ${e.shortName} trabalha em sábados consecutivos (${fmtShort(prev)} e ${d}).`,
        });
      }
      if (!isExtra(day)) lastWorked.set(e.id, day.date);
    }

    // Requisitos por atividade
    const counts = countActivities(day);
    for (const r of dayRequirements(day, ctx.requirements)) {
      if (r.minCount <= 0) continue;
      const c = counts[r.skillId] ?? { confirmed: 0, pending: 0 };
      if (c.confirmed >= r.minCount) continue;
      const name = skillName(r.skillId);
      const pendingNote = c.pending > 0 ? ` Há ${c.pending} vaga(s) reservada(s) para ${name}, ainda sem colaborador confirmado.` : '';
      issues.push({
        severity: r.mandatory ? 'error' : 'warning',
        code: r.mandatory ? 'requirement' : 'preference',
        date: day.date,
        message: `${d}: ${name} com ${c.confirmed} de ${r.minCount} pessoa(s) exigida(s).${pendingNote}`,
        suggestions: suggestForSkill(r.skillId, day, ctx),
      });
    }

    const pend = pendingCount(day);
    if (pend > 0) {
      issues.push({ severity: 'info', code: 'reserved', date: day.date, message: `${d}: ${pend} vaga(s) reservada(s) aguardando colaborador.` });
    }
    const ideal = dayIdeal(day, ctx.settings);
    if (total < ideal) {
      issues.push({
        severity: 'warning', code: 'understaffed', date: day.date,
        message: `${d}: equipe com ${total} de ${ideal} vagas ideais preenchidas.`,
      });
    }
  }

  for (const [id, count] of monthCount) {
    const e = empById.get(id);
    if (!e) continue;
    if (ctx.quotas) {
      const q = ctx.quotas[id] ?? 0;
      if (count > q) {
        issues.push({ severity: 'error', code: 'over-quota', employeeId: id, message: `${e.shortName} está em ${count} datas, acima da cota de ${q}.`, suggestions: ['Aumente a cota no banco de participações ou remova uma participação.'] });
      }
      continue;
    }
    const cap = capFor(e, ctx.settings.maxPerMonth);
    if (count > cap) {
      issues.push({
        severity: 'warning', code: 'over-cap', employeeId: id,
        message: `${e.shortName} está em ${count} sábados, acima do máximo de ${cap} por mês.`,
      });
    }
  }
  if (ctx.quotas) {
    const pending = Object.entries(ctx.quotas)
      .map(([id, q]) => ({ e: empById.get(id), left: q - (monthCount.get(id) ?? 0) }))
      .filter((x) => x.e && x.left > 0);
    if (pending.length) {
      issues.push({
        severity: 'info', code: 'quota-left',
        message: `Participações ainda no banco: ${pending.map((x) => `${x.e!.shortName} (${x.left})`).join(', ')}.`,
      });
    }
  }

  // Equilíbrio: diferença entre quem mais e quem menos trabalha entre os elegíveis do mês
  const eligible = ctx.employees.filter((e) => sorted.some((d) => checkAvailability(e, d.date, ctx.unavailability).ok));
  if (!ctx.quotas && eligible.length > 1 && sorted.length > 0) {
    const counts = eligible.map((e) => monthCount.get(e.id) ?? 0);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (max - min > 1) {
      const low = eligible.filter((e) => (monthCount.get(e.id) ?? 0) === min).map((e) => e.shortName);
      issues.push({
        severity: 'warning', code: 'imbalance',
        message: `Distribuição desigual: há pessoas com ${max} sábados e outras com ${min} (${low.slice(0, 4).join(', ')}).`,
        suggestions: ['Use “Regerar sábados restantes” ou troque participações entre colaboradores.'],
      });
    }
  }
  return issues;
}

function suggestForSkill(skillId: string, day: DayView, ctx: ValidationContext): string[] {
  const inDay = new Set(day.members.map((m) => m.employeeId).filter(Boolean));
  const qualified = ctx.employees.filter((e) => e.skillIds.includes(skillId));
  const available = qualified.filter((e) => !inDay.has(e.id) && checkAvailability(e, day.date, ctx.unavailability).ok);
  const out: string[] = [];
  if (available.length) out.push(`Disponíveis e habilitados: ${available.map((e) => e.shortName).join(', ')}.`);
  const unavailable = qualified.filter((e) => !available.includes(e) && !inDay.has(e.id));
  if (unavailable.length) {
    out.push(
      `Indisponíveis: ${unavailable
        .map((e) => `${e.shortName} (${checkAvailability(e, day.date, ctx.unavailability).reason ?? 'já escalado'})`)
        .join(', ')}.`,
    );
  }
  out.push('Habilite outro colaborador para esta atividade ou reserve uma vaga com essa habilidade obrigatória.');
  return out;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error');
