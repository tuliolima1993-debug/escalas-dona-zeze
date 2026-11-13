import { inRange } from './dates';
import type { Employee, ISODate, Unavailability } from './types';

export interface EligibilityResult {
  ok: boolean;
  reason?: string;
}

/** Verifica se a pessoa pode ser escalada na data (restrição obrigatória). */
export function checkAvailability(
  e: Employee,
  date: ISODate,
  unavailability: Unavailability[],
): EligibilityResult {
  if (e.status === 'inactive') return { ok: false, reason: 'inativo' };
  if (e.status === 'vacation') return { ok: false, reason: 'em férias' };
  if (e.status === 'leave') return { ok: false, reason: 'afastado' };
  if (e.admissionDate && date < e.admissionDate) return { ok: false, reason: 'ainda não admitido' };
  const block = unavailability.find(
    (u) => u.employeeId === e.id && inRange(date, u.startDate, u.endDate),
  );
  if (block) return { ok: false, reason: block.reason ? `indisponível (${block.reason})` : 'indisponível nesta data' };
  return { ok: true };
}

export const hasSkill = (e: Employee, skillId: string | null | undefined) =>
  !skillId || e.skillIds.includes(skillId);

export const capFor = (e: Employee, defaultCap: number) =>
  e.maxPerMonth != null && e.maxPerMonth > 0 ? e.maxPerMonth : defaultCap;
