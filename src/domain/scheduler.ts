/**
 * Motor de geração de escalas.
 *
 * Estratégia determinística em três fases (sem sorteio):
 *  A. Cobertura obrigatória: as vagas de atividades obrigatórias (ex.: Clonagem) são resolvidas com
 *     emparelhamento por caminhos aumentantes (algoritmo de Kuhn), o que garante encontrar uma
 *     cobertura sempre que ela existir, respeitando disponibilidade e limite mensal. Os candidatos
 *     são testados na ordem da pontuação de equilíbrio.
 *  B. Preenchimento: as vagas restantes de cada sábado são preenchidas pela menor pontuação.
 *  C. Refinamento: trocas entre sábados que reduzam penalidades (consecutivos, intervalos curtos,
 *     duplas repetidas) sem alterar a quantidade de participações de ninguém.
 *
 * Pontuação (quanto menor, melhor) — exibida ao administrador:
 *   peso_mês × participações já atribuídas no mês
 * + peso_histórico × desvio do histórico acumulado em relação à média (limitado a ±2)
 * + peso_consecutivo se trabalharia em sábados seguidos
 * + peso_intervalo × semanas faltantes para o intervalo preferido
 * + peso_dupla × vezes que já trabalhou com alguém da equipe neste mês
 * O peso do mês é maior que a soma de todos os outros (na prioridade "alta"), então a diferença
 * de participações entre os elegíveis nunca passa de 1 quando a disponibilidade permite; o histórico
 * decide quem fica com a participação a menos, compensando nos meses seguintes.
 */
import { capFor, checkAvailability, hasSkill } from './eligibility';
import { fmtShort, saturdaysOfMonth, weeksBetween } from './dates';
import { dayRequirements, hasErrors, validateMonth, type DayMember, type DayView, type Issue } from './validate';
import type { BalancePriority, DayKind, Employee, ISODate, Requirement, Sector, Skill, Unavailability } from './types';

export interface PastParticipation {
  employeeId: string;
  date: ISODate;
}

export interface GenerateOptions {
  year: number;
  month: number;
  idealPerDay: number;
  maxPerDay: number;
  startTime: string;
  endTime: string;
  maxPerMonth: number;
  avoidConsecutive: boolean;
  minGapWeeks: number;
  balancePriority: BalancePriority;
  requirements: Requirement[];
  /** Pessoas consideradas disponíveis para este mês (padrão: todas as ativas). */
  availableEmployeeIds?: string[];
  /** Se informado, apenas estas datas são (re)geradas; as demais são preservadas como estão. */
  regenerateDates?: ISODate[];
  /** Banco de cotas: limite individual de participações no mês (substitui maxPerMonth). */
  quotas?: Record<string, number>;
}

export interface ExistingDay {
  date: ISODate;
  locked: boolean;
  startTime: string;
  endTime: string;
  members: DayMember[];
  kind?: DayKind;
  label?: string | null;
  countsInQuota?: boolean;
  idealSize?: number | null;
  requirements?: Requirement[] | null;
}

export interface GenerateInput {
  options: GenerateOptions;
  employees: Employee[];
  skills: Skill[];
  sectors: Sector[];
  unavailability: Unavailability[];
  existingDays: ExistingDay[];
  /** Participações efetivas anteriores ao mês (escalado e não ausente). */
  history: PastParticipation[];
}

export interface ProposedMember extends DayMember {
  fixed: boolean;
  kind: 'fixed' | 'required' | 'fill';
  reason?: string;
}

export interface ProposedDay extends DayView {
  members: ProposedMember[];
  regenerated: boolean;
}

export interface DistributionRow {
  employeeId: string;
  name: string;
  history: number;
  month: number;
  total: number;
}

export interface ScoreSummary {
  spread: number; // máx - mín de participações no mês entre elegíveis
  consecutive: number;
  shortGaps: number;
  repeatedPairs: number;
}

export interface GenerateResult {
  days: ProposedDay[];
  issues: Issue[];
  distribution: DistributionRow[];
  summary: ScoreSummary;
  slots: number;
  filled: number;
  valid: boolean;
}

export const WEIGHTS: Record<BalancePriority, { month: number; history: number; consecutive: number; gap: number; pair: number }> = {
  high: { month: 100, history: 12, consecutive: 30, gap: 6, pair: 2 },
  medium: { month: 100, history: 6, consecutive: 45, gap: 8, pair: 3 },
  low: { month: 40, history: 3, consecutive: 60, gap: 10, pair: 4 },
};

/** Hash estável (FNV-1a) para desempates determinísticos que variam de mês para mês. */
function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

export function defaultActivity(e: Employee, sectors: Sector[], skills: Skill[]): string | null {
  const sector = sectors.find((s) => s.id === e.sectorId);
  if (sector?.defaultSkillId && e.skillIds.includes(sector.defaultSkillId)) return sector.defaultSkillId;
  const ordered = [...skills].sort((a, b) => a.sortOrder - b.sortOrder).filter((s) => e.skillIds.includes(s.id));
  return ordered[0]?.id ?? null;
}

export function generateSchedule(input: GenerateInput): GenerateResult {
  const { options: o, employees, skills, sectors, unavailability } = input;
  const W = WEIGHTS[o.balancePriority];
  const extraDates = input.existingDays.filter((d) => d.kind === 'extra').map((d) => d.date);
  const dates = Array.from(new Set([...saturdaysOfMonth(o.year, o.month), ...extraDates])).sort();
  const baseTarget = Math.max(0, Math.min(o.idealPerDay, o.maxPerDay));
  const regenSet = o.regenerateDates ? new Set(o.regenerateDates) : null;
  const existingByDate = new Map(input.existingDays.map((d) => [d.date, d]));
  const skillName = (id: string | null) => skills.find((s) => s.id === id)?.name ?? '—';
  const ym = `${o.year}-${o.month}`;

  const pool = employees.filter(
    (e) => e.status === 'active' && (!o.availableEmployeeIds || o.availableEmployeeIds.includes(e.id)),
  );
  const empById = new Map(employees.map((e) => [e.id, e]));

  // Histórico acumulado
  const histCount = new Map<string, number>();
  const lastBefore: Record<string, ISODate | undefined> = {};
  for (const p of input.history) {
    histCount.set(p.employeeId, (histCount.get(p.employeeId) ?? 0) + 1);
    if (!lastBefore[p.employeeId] || p.date > lastBefore[p.employeeId]!) lastBefore[p.employeeId] = p.date;
  }
  const meanHist = pool.length ? pool.reduce((s, e) => s + (histCount.get(e.id) ?? 0), 0) / pool.length : 0;
  const histDev = (id: string) => Math.max(-2, Math.min(2, (histCount.get(id) ?? 0) - meanHist)) + 2;

  // Estado de trabalho
  const days: ProposedDay[] = dates.map((date) => {
    const ex = existingByDate.get(date);
    const regenerate = !ex?.locked && (!regenSet || regenSet.has(date));
    let members: ProposedMember[];
    if (!ex) members = [];
    else if (!regenerate) members = ex.members.map((m) => ({ ...m, fixed: true, kind: 'fixed' as const }));
    // Em sábados regerados, vagas reservadas são decisões do administrador: permanecem.
    else members = ex.members.filter((m) => m.reservedLabel).map((m) => ({ ...m, fixed: true, kind: 'fixed' as const }));
    const extra = ex?.kind === 'extra';
    return {
      date,
      startTime: ex && (!regenerate || extra) ? ex.startTime : o.startTime,
      endTime: ex && (!regenerate || extra) ? ex.endTime : o.endTime,
      locked: !!ex?.locked,
      members,
      regenerated: regenerate,
      kind: ex?.kind ?? 'regular',
      label: ex?.label ?? null,
      countsInQuota: ex?.countsInQuota ?? true,
      idealSize: ex?.idealSize ?? null,
      requirements: extra ? ex?.requirements ?? [] : null,
    };
  });
  const targetOf = (d: ProposedDay) => Math.max(0, Math.min(d.idealSize ?? baseTarget, o.maxPerDay));
  const reqsOf = (d: ProposedDay) => dayRequirements(d, o.requirements);
  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const open = days.filter((d) => d.regenerated);

  // Datas regulares (sábados) entram no cálculo de intervalos; extras não contam como "sábado seguido".
  const datesOf = (id: string) => days.filter((d) => d.kind !== 'extra' && d.members.some((m) => m.employeeId === id)).map((d) => d.date);
  const monthCount = (id: string) => days.filter((d) => d.members.some((m) => m.employeeId === id)).length;
  const quotaCount = (id: string) => days.filter((d) => d.countsInQuota !== false && d.members.some((m) => m.employeeId === id)).length;
  const inDay = (d: ProposedDay, id: string) => d.members.some((m) => m.employeeId === id);
  const capOf = (e: Employee) => (o.quotas ? o.quotas[e.id] ?? 0 : capFor(e, o.maxPerMonth));
  const remainingCap = (e: Employee, d?: ProposedDay) => (d && d.countsInQuota === false ? 1 : capOf(e) - quotaCount(e.id));
  const eligibleOn = (e: Employee, d: ProposedDay) =>
    checkAvailability(e, d.date, unavailability).ok && !inDay(d, e.id);

  const pairCount = (a: string, b: string, exceptDate?: ISODate) =>
    days.filter((d) => d.date !== exceptDate && inDay(d, a) && inDay(d, b)).length;

  function scoreParts(e: Employee, d: ProposedDay) {
    const worked = datesOf(e.id).filter((x) => x !== d.date);
    if (lastBefore[e.id]) worked.push(lastBefore[e.id]!);
    const minWeeks = d.kind === 'extra' || !worked.length ? 99 : Math.min(...worked.map((x) => weeksBetween(x, d.date)));
    const consecutive = o.avoidConsecutive && minWeeks === 1 ? 1 : 0;
    const gapShort = Math.max(0, o.minGapWeeks - minWeeks);
    const pairs = d.members.reduce((s, m) => s + (m.employeeId ? pairCount(e.id, m.employeeId, d.date) : 0), 0);
    const mc = monthCount(e.id);
    // Com banco de cotas, quem tem mais participações a cumprir vem primeiro (garante usar a cota inteira)
    const monthTerm = o.quotas ? -(capOf(e) - quotaCount(e.id)) : mc;
    return {
      month: mc,
      history: histCount.get(e.id) ?? 0,
      consecutive,
      gapShort,
      pairs,
      total:
        W.month * monthTerm + W.history * histDev(e.id) + W.consecutive * consecutive + W.gap * gapShort + W.pair * pairs +
        stableHash(e.id + ym + d.date) * 0.5,
    };
  }

  const rank = (cands: Employee[], d: ProposedDay) =>
    cands.map((e) => ({ e, s: scoreParts(e, d) })).sort((a, b) => a.s.total - b.s.total);

  function reasonFor(s: ReturnType<typeof scoreParts>, prefix?: string) {
    const parts = [] as string[];
    if (prefix) parts.push(prefix);
    parts.push(s.month === 0 ? '1ª participação no mês' : `${s.month + 1}ª participação no mês`);
    parts.push(`histórico ${s.history} (média ${meanHist.toFixed(1).replace('.', ',')})`);
    if (s.consecutive) parts.push('sábado consecutivo (sem alternativa melhor)');
    return parts.join(' · ');
  }

  // ---------- Fase A: atividades obrigatórias (emparelhamento) ----------
  interface Slot { date: ISODate; skillId: string; holder: string | null }
  const slots: Slot[] = [];
  for (const d of open) {
    let free = targetOf(d) - d.members.length;
    for (const r of reqsOf(d).filter((x) => x.mandatory && x.minCount > 0)) {
      const have = d.members.filter((m) => m.employeeId && m.activityId === r.skillId).length;
      for (let k = have; k < r.minCount && free > 0; k++, free--) slots.push({ date: d.date, skillId: r.skillId, holder: null });
    }
  }
  const candidatesFor = (slot: Slot) =>
    pool.filter((e) => hasSkill(e, slot.skillId) && eligibleOn(e, dayByDate.get(slot.date)!));
  slots.sort((a, b) => candidatesFor(a).length - candidatesFor(b).length || a.date.localeCompare(b.date));

  const placeSlot = (slot: Slot, e: Employee) => {
    slot.holder = e.id;
    dayByDate.get(slot.date)!.members.push({
      key: `${slot.date}-${e.id}`, employeeId: e.id, activityId: slot.skillId,
      reservedLabel: null, requiredSkillId: null, fixed: false, kind: 'required',
    });
  };
  const unplaceSlot = (slot: Slot) => {
    const d = dayByDate.get(slot.date)!;
    d.members = d.members.filter((m) => !(m.employeeId === slot.holder && m.kind === 'required'));
    slot.holder = null;
  };

  function augment(slot: Slot, visited: Set<string>): boolean {
    const d = dayByDate.get(slot.date)!;
    for (const { e } of rank(candidatesFor(slot), d)) {
      if (visited.has(e.id)) continue;
      visited.add(e.id);
      if (remainingCap(e, d) > 0) {
        placeSlot(slot, e);
        return true;
      }
      for (const other of slots.filter((s) => s.holder === e.id)) {
        unplaceSlot(other);
        if (augment(other, visited)) {
          placeSlot(slot, e);
          return true;
        }
        placeSlot(other, e);
      }
    }
    return false;
  }
  const unmatched: Slot[] = [];
  for (const slot of slots) if (!augment(slot, new Set())) unmatched.push(slot);

  // Atividades preferenciais (não obrigatórias): tentativa gulosa
  for (const d of open) {
    for (const r of reqsOf(d).filter((x) => !x.mandatory && x.minCount > 0)) {
      let have = d.members.filter((m) => m.employeeId && m.activityId === r.skillId).length;
      while (have < r.minCount && d.members.length < targetOf(d)) {
        const cands = pool.filter((e) => hasSkill(e, r.skillId) && eligibleOn(e, d) && remainingCap(e, d) > 0);
        if (!cands.length) break;
        const best = rank(cands, d)[0];
        d.members.push({
          key: `${d.date}-${best.e.id}`, employeeId: best.e.id, activityId: r.skillId,
          reservedLabel: null, requiredSkillId: null, fixed: false, kind: 'required',
          reason: reasonFor(best.s, `${skillName(r.skillId)} (preferencial)`),
        });
        have++;
      }
    }
  }
  // Motivos das vagas obrigatórias (calculados após o emparelhamento final)
  for (const d of open) {
    for (const m of d.members) {
      if (m.kind !== 'required' || m.reason || !m.employeeId) continue;
      const n = monthCount(m.employeeId);
      m.reason = `${skillName(m.activityId)} obrigatória · ${n}ª participação no mês · histórico ${histCount.get(m.employeeId) ?? 0} (média ${meanHist.toFixed(1).replace('.', ',')})`;
    }
  }

  // ---------- Fase B: preenchimento equilibrado ----------
  const shortages: { date: ISODate; missing: number }[] = [];
  for (const d of open) {
    while (d.members.length < targetOf(d)) {
      const cands = pool.filter((e) => eligibleOn(e, d) && remainingCap(e, d) > 0);
      if (!cands.length) {
        shortages.push({ date: d.date, missing: targetOf(d) - d.members.length });
        break;
      }
      const best = rank(cands, d)[0];
      d.members.push({
        key: `${d.date}-${best.e.id}`, employeeId: best.e.id,
        activityId: defaultActivity(best.e, sectors, skills),
        reservedLabel: null, requiredSkillId: null, fixed: false, kind: 'fill',
        reason: reasonFor(best.s),
      });
    }
  }

  // ---------- Fase C: refinamento por trocas ----------
  const penalty = () => {
    let p = 0;
    for (const e of pool) {
      const ds = datesOf(e.id).concat(lastBefore[e.id] ? [lastBefore[e.id]!] : []).sort();
      for (let i = 1; i < ds.length; i++) {
        const w = weeksBetween(ds[i - 1], ds[i]);
        if (o.avoidConsecutive && w === 1) p += W.consecutive;
        p += W.gap * Math.max(0, o.minGapWeeks - w);
      }
    }
    for (const d of days) {
      const ids = d.members.map((m) => m.employeeId).filter((x): x is string => !!x);
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) p += W.pair * pairCount(ids[i], ids[j], d.date);
    }
    return p;
  };
  const canTake = (e: Employee, m: ProposedMember) => m.kind !== 'required' || hasSkill(e, m.activityId);
  let current = penalty();
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const d1 = open[i], d2 = open[j];
        for (const m1 of d1.members.filter((m) => !m.fixed && m.employeeId)) {
          for (const m2 of d2.members.filter((m) => !m.fixed && m.employeeId)) {
            const a = empById.get(m1.employeeId!)!, b = empById.get(m2.employeeId!)!;
            if (inDay(d2, a.id) || inDay(d1, b.id)) continue;
            if (!checkAvailability(a, d2.date, unavailability).ok || !checkAvailability(b, d1.date, unavailability).ok) continue;
            if (!canTake(a, m2) || !canTake(b, m1)) continue;
            const snap = [m1.employeeId, m1.activityId, m2.employeeId, m2.activityId] as const;
            m1.employeeId = b.id; m2.employeeId = a.id;
            if (m1.kind === 'fill') m1.activityId = defaultActivity(b, sectors, skills);
            if (m2.kind === 'fill') m2.activityId = defaultActivity(a, sectors, skills);
            const next = penalty();
            if (next < current - 1e-9) {
              current = next;
              improved = true;
              m1.key = `${d1.date}-${b.id}`; m2.key = `${d2.date}-${a.id}`;
              m1.reason = (m1.reason ?? '') + ' · ajustado para evitar repetições';
              m2.reason = (m2.reason ?? '') + ' · ajustado para evitar repetições';
            } else {
              [m1.employeeId, m1.activityId, m2.employeeId, m2.activityId] = snap;
            }
          }
        }
      }
    }
    if (!improved) break;
  }

  // Ordena membros: obrigatórios primeiro, depois por nome
  const skillOrder = new Map(skills.map((s) => [s.id, s.sortOrder]));
  for (const d of days) {
    d.members.sort((x, y) => {
      const ax = x.employeeId ? 0 : 1, ay = y.employeeId ? 0 : 1;
      if (ax !== ay) return ax - ay;
      const sx = skillOrder.get(x.activityId ?? '') ?? 99, sy = skillOrder.get(y.activityId ?? '') ?? 99;
      if (sx !== sy) return sx - sy;
      return (empById.get(x.employeeId ?? '')?.shortName ?? '').localeCompare(empById.get(y.employeeId ?? '')?.shortName ?? '');
    });
  }

  // ---------- Validação e conflitos explicados ----------
  const issues = validateMonth(days, {
    employees, skills, unavailability, requirements: o.requirements,
    settings: { maxPerDay: o.maxPerDay, idealPerDay: baseTarget, maxPerMonth: o.maxPerMonth, avoidConsecutive: o.avoidConsecutive, startTime: o.startTime, endTime: o.endTime },
    lastWorkedBefore: lastBefore,
    quotas: o.quotas,
  }).filter((i) => i.code !== 'imbalance' || !shortages.length);

  for (const s of unmatched) {
    const already = issues.find((i) => i.code === 'requirement' && i.date === s.date);
    const qualified = employees.filter((e) => e.skillIds.includes(s.skillId));
    const d = dayByDate.get(s.date)!;
    const reasons = qualified.map((e) => {
      if (!pool.includes(e)) return `${e.shortName}: ${e.status !== 'active' ? checkAvailability(e, s.date, []).reason : 'não selecionado(a) como disponível'}`;
      const av = checkAvailability(e, s.date, unavailability);
      if (!av.ok) return `${e.shortName}: ${av.reason}`;
      if (inDay(d, e.id)) return `${e.shortName}: já escalado(a) neste sábado`;
      return `${e.shortName}: atingiu ${o.quotas ? 'a cota' : 'o limite'} de ${capOf(e)} participação(ões) no mês`;
    });
    const msg = `Não foi possível cobrir ${skillName(s.skillId)} em ${fmtShort(s.date)}. ${reasons.length ? 'Motivos: ' + reasons.join('; ') + '.' : 'Nenhum colaborador possui essa habilidade.'}`;
    if (already) {
      already.message = msg;
    } else {
      issues.push({ severity: 'error', code: 'requirement', date: s.date, message: msg, suggestions: [] });
    }
    const issue = already ?? issues[issues.length - 1];
    issue.suggestions = [
      'Habilite outro colaborador para esta atividade em Colaboradores.',
      `Aumente o limite de repetições por mês (atual: ${o.maxPerMonth}).`,
      'Revise a disponibilidade/afastamentos dos habilitados.',
      `Reserve uma vaga com a habilidade ${skillName(s.skillId)} obrigatória para um novo colaborador.`,
    ];
  }
  for (const s of shortages) {
    const i = issues.find((x) => x.code === 'understaffed' && x.date === s.date);
    const text = o.quotas
      ? `Faltam ${s.missing} pessoa(s): as cotas disponíveis já foram usadas. Aumente alguma cota no banco de participações.`
      : `Faltam ${s.missing} pessoa(s): não há colaboradores disponíveis sem ultrapassar o limite de ${o.maxPerMonth} sábado(s) por mês.`;
    if (i) {
      i.message += ' ' + text;
      i.suggestions = ['Aumente o limite de repetições por mês.', 'Reserve vagas para novos colaboradores.', 'Revise as indisponibilidades cadastradas.'];
    }
  }

  // ---------- Resumo ----------
  const distribution: DistributionRow[] = pool
    .map((e) => ({ employeeId: e.id, name: e.shortName, history: histCount.get(e.id) ?? 0, month: quotaCount(e.id), total: (histCount.get(e.id) ?? 0) + quotaCount(e.id) }))
    .sort((a, b) => b.month - a.month || a.name.localeCompare(b.name));
  const eligibleCounts = pool.filter((e) => days.some((d) => checkAvailability(e, d.date, unavailability).ok)).map((e) => quotaCount(e.id));
  let consecutive = 0, shortGaps = 0, repeatedPairs = 0;
  for (const e of pool) {
    const ds = datesOf(e.id);
    if (ds.length && lastBefore[e.id]) ds.unshift(lastBefore[e.id]!); // inclui a virada do mês
    for (let i = 1; i < ds.length; i++) {
      const w = weeksBetween(ds[i - 1], ds[i]);
      if (w === 1) consecutive++;
      else if (w < o.minGapWeeks) shortGaps++;
    }
  }
  for (const d of days) {
    const ids = d.members.map((m) => m.employeeId).filter((x): x is string => !!x);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (pairCount(ids[i], ids[j], d.date) > 0) repeatedPairs++;
  }
  repeatedPairs = Math.round(repeatedPairs / 2);

  const slotsTotal = open.reduce((n, d) => n + targetOf(d), 0);
  const filled = open.reduce((s, d) => s + d.members.filter((m) => m.employeeId).length, 0);
  return {
    days,
    issues,
    distribution,
    summary: {
      spread: eligibleCounts.length ? Math.max(...eligibleCounts) - Math.min(...eligibleCounts) : 0,
      consecutive, shortGaps, repeatedPairs,
    },
    slots: slotsTotal,
    filled,
    valid: !hasErrors(issues),
  };
}
