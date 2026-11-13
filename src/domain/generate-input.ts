import { monthStart } from './dates';
import type { CommitPayload } from './mutations';
import { generateSchedule, type GenerateInput, type GenerateOptions, type GenerateResult } from './scheduler';
import { dayViewsFor, pastParticipations, quotasFor } from './stats';
import type { Snapshot } from './types';

/** Monta a entrada do motor a partir dos dados salvos + parâmetros escolhidos na tela. */
export function buildGenerateInput(
  s: Snapshot,
  year: number,
  month: number,
  overrides: Partial<GenerateOptions> = {},
): GenerateInput {
  const st = s.settings;
  const options: GenerateOptions = {
    year,
    month,
    idealPerDay: st.idealPerDay,
    maxPerDay: st.maxPerDay,
    startTime: st.startTime,
    endTime: st.endTime,
    maxPerMonth: st.maxPerMonth,
    avoidConsecutive: st.avoidConsecutive,
    minGapWeeks: st.minGapWeeks,
    balancePriority: st.balancePriority,
    requirements: s.requirements,
    quotas: quotasFor(s, year, month),
    ...overrides,
  };
  return {
    options,
    employees: s.employees,
    skills: s.skills.filter((k) => k.active),
    sectors: s.sectors,
    unavailability: s.unavailability,
    existingDays: dayViewsFor(s, year, month)
      .filter((d) => d.workDay)
      .map((d) => ({
        date: d.date, locked: d.locked, startTime: d.startTime, endTime: d.endTime, members: d.members,
        kind: d.kind, label: d.label, countsInQuota: d.countsInQuota, idealSize: d.idealSize, requirements: d.requirements,
      })),
    history: pastParticipations(s, monthStart(year, month), st.considerHistoryMonths),
  };
}

export function resultToCommit(r: GenerateResult, year: number, month: number): CommitPayload {
  return {
    year,
    month,
    days: r.days
      .filter((d) => d.regenerated)
      .map((d) => ({
        date: d.date,
        startTime: d.startTime,
        endTime: d.endTime,
        members: d.members.map((m) => ({
          employeeId: m.employeeId,
          activityId: m.activityId,
          reservedLabel: m.reservedLabel,
          requiredSkillId: m.requiredSkillId,
        })),
      })),
  };
}

/**
 * Sugestão de cotas do mês: simula a distribuição equilibrada (mesmo motor, mesmas regras,
 * histórico e disponibilidade) e devolve quantas participações cada pessoa deveria ter.
 * Datas já bloqueadas entram como estão.
 */
export function suggestQuotas(s: Snapshot, year: number, month: number): { quotas: Record<string, number>; total: number } {
  const run = (maxPerMonth: number) => {
    const input = buildGenerateInput(s, year, month, { quotas: undefined, maxPerMonth });
    // simula o mês inteiro sem a equipe atual (apenas datas bloqueadas permanecem)
    input.existingDays = input.existingDays.map((d) => (d.locked ? d : { ...d, members: d.members.filter((m) => !m.employeeId && m.reservedLabel) }));
    const r = generateSchedule(input);
    const quotas: Record<string, number> = {};
    for (const e of s.employees.filter((x) => x.status === 'active')) quotas[e.id] = 0;
    for (const d of r.days) {
      if (d.countsInQuota === false) continue;
      for (const m of d.members) if (m.employeeId) quotas[m.employeeId] = (quotas[m.employeeId] ?? 0) + 1;
    }
    const total = r.days.filter((d) => d.countsInQuota !== false).reduce((n, d) => n + Math.min(d.idealSize ?? s.settings.idealPerDay, s.settings.maxPerDay), 0);
    return { quotas, total, sum: Object.values(quotas).reduce((a, b) => a + b, 0) };
  };
  // Se o limite mensal não permitir cobrir todas as vagas, aceita uma participação a mais por pessoa
  let res = run(s.settings.maxPerMonth);
  for (let cap = s.settings.maxPerMonth + 1; res.sum < res.total && cap <= 5; cap++) res = run(cap);
  return { quotas: res.quotas, total: res.total };
}
