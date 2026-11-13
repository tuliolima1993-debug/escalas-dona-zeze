import { useMemo } from 'react';
import { useSnapshot } from '@/data/DataProvider';
import { monthStart } from '@/domain/dates';
import { dayViewsFor, lastWorkedBefore } from '@/domain/stats';
import { validateMonth, type Issue } from '@/domain/validate';
import type { Snapshot } from '@/domain/types';

export function makeLookups(s: Snapshot) {
  const emp = new Map(s.employees.map((e) => [e.id, e]));
  const skill = new Map(s.skills.map((k) => [k.id, k]));
  const sector = new Map(s.sectors.map((k) => [k.id, k]));
  const skillsSorted = [...s.skills].filter((k) => k.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const mandatorySkillIds = s.requirements.filter((r) => r.mandatory && r.minCount > 0).map((r) => r.skillId);
  return {
    emp, skill, sector, skillsSorted, mandatorySkillIds,
    skillColor: (id: string | null | undefined) => (id && skill.get(id)?.color) || '#94a3b8',
    skillName: (id: string | null | undefined) => (id && skill.get(id)?.name) || 'Sem atividade',
    empName: (id: string | null | undefined) => (id && emp.get(id)?.shortName) || '—',
  };
}

export function useLookups() {
  const { s } = useSnapshot();
  return useMemo(() => makeLookups(s), [s]);
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Dias do mês + validação completa (as mesmas regras do motor). */
export function useMonthView(year: number, month: number) {
  const { s } = useSnapshot();
  return useMemo(() => {
    const days = dayViewsFor(s, year, month);
    const issues: Issue[] = validateMonth(days, {
      employees: s.employees, skills: s.skills, unavailability: s.unavailability, requirements: s.requirements,
      settings: s.settings, lastWorkedBefore: lastWorkedBefore(s, monthStart(year, month)), today: todayISO(),
    });
    const schedule = s.schedules.find((x) => x.year === year && x.month === month) ?? null;
    return { days, issues, schedule };
  }, [s, year, month]);
}
