import { describe, expect, it } from 'vitest';
import { saturdaysOfMonth } from '../src/domain/dates';
import { buildGenerateInput, resultToCommit } from '../src/domain/generate-input';
import {
  addAssignment, commitMonth, DomainError, replaceAssignment, setAttendance, setDayLocked, swapAssignments,
} from '../src/domain/mutations';
import { generateSchedule, type GenerateOptions } from '../src/domain/scheduler';
import { seedSnapshot, SKILL } from '../src/domain/seed';
import { dayViewsFor, employeeStats } from '../src/domain/stats';
import { validateMonth, countActivities, hasErrors } from '../src/domain/validate';
import type { Snapshot } from '../src/domain/types';

const NOV = { year: 2026, month: 11 }; // 4 sábados: 07, 14, 21, 28
const AUG = { year: 2026, month: 8 }; // 5 sábados

function gen(s: Snapshot, ym = NOV, o: Partial<GenerateOptions> = {}) {
  return generateSchedule(buildGenerateInput(s, ym.year, ym.month, o));
}
function genAndSave(s: Snapshot, ym = NOV, o: Partial<GenerateOptions> = {}) {
  const r = gen(s, ym, o);
  return { r, s: commitMonth(s, resultToCommit(r, ym.year, ym.month)) };
}
const countsOf = (r: ReturnType<typeof gen>) => r.distribution.map((d) => d.month);
const ctx = (s: Snapshot) => ({
  employees: s.employees, skills: s.skills, unavailability: s.unavailability, requirements: s.requirements, settings: s.settings,
});
const idOf = (s: Snapshot, short: string) => s.employees.find((e) => e.shortName.startsWith(short))!.id;

describe('calendário', () => {
  it('identifica 4 e 5 sábados', () => {
    expect(saturdaysOfMonth(2026, 11)).toEqual(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
    expect(saturdaysOfMonth(2026, 8)).toHaveLength(5);
  });
});

describe('motor de geração', () => {
  it('1. mês com quatro sábados: 16 vagas → 7 pessoas com 2 e 2 com 1, clonagem coberta', () => {
    const r = gen(seedSnapshot());
    expect(r.days).toHaveLength(4);
    expect(r.filled).toBe(16);
    const counts = countsOf(r);
    expect(counts.filter((c) => c === 2)).toHaveLength(7);
    expect(counts.filter((c) => c === 1)).toHaveLength(2);
    for (const d of r.days) {
      expect(d.members).toHaveLength(4);
      expect(countActivities(d)[SKILL.clonagem].confirmed).toBeGreaterThanOrEqual(1);
    }
    expect(r.valid).toBe(true);
    expect(r.summary.spread).toBe(1);
  });

  it('é determinístico (mesma entrada → mesma escala)', () => {
    const a = gen(seedSnapshot()), b = gen(seedSnapshot());
    expect(a.days.map((d) => d.members.map((m) => m.employeeId))).toEqual(b.days.map((d) => d.members.map((m) => m.employeeId)));
  });

  it('2. mês com cinco sábados: 20 vagas distribuídas com diferença máxima de 1', () => {
    const r = gen(seedSnapshot(), AUG, { maxPerMonth: 3 });
    expect(r.days).toHaveLength(5);
    expect(r.filled).toBe(20);
    const counts = countsOf(r);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(r.valid).toBe(true);
  });

  it('3. quantidade insuficiente de colaboradores: aponta vagas pendentes e explica', () => {
    const s = seedSnapshot();
    s.employees.forEach((e, i) => { if (i >= 4 && e.id !== 'em-marcelo') e.status = 'inactive'; });
    const r = gen(s); // 5 ativos × 2 = 10 participações para 16 vagas
    expect(r.filled).toBe(10);
    const under = r.issues.filter((i) => i.code === 'understaffed');
    expect(under.length).toBeGreaterThan(0);
    expect(under[0].message).toMatch(/Faltam/);
    expect(under[0].suggestions?.length).toBeGreaterThan(0);
  });

  it('4. todos os habilitados para clonagem indisponíveis: conflito obrigatório explicado, escala inválida', () => {
    const s = seedSnapshot();
    for (const id of ['em-ediane', 'em-jose', 'em-marcelo', 'em-edna'])
      s.unavailability.push({ id: 'u-' + id, employeeId: id, startDate: '2026-11-14', endDate: '2026-11-14', reason: 'folga' });
    const r = gen(s);
    expect(r.valid).toBe(false);
    const c = r.issues.find((i) => i.code === 'requirement' && i.date === '2026-11-14')!;
    expect(c.severity).toBe('error');
    expect(c.message).toMatch(/Clonagem/);
    expect(c.message).toMatch(/Edna Gomes: indisponível \(folga\)/);
    expect(c.suggestions!.length).toBeGreaterThan(1);
    // os demais sábados continuam cobertos
    for (const d of r.days.filter((x) => x.date !== '2026-11-14')) expect(countActivities(d)[SKILL.clonagem]?.confirmed).toBeGreaterThanOrEqual(1);
  });

  it('4b. emparelhamento encontra a cobertura mesmo quando a escolha gulosa falharia', () => {
    const s = seedSnapshot();
    // Apenas Edna e Marcelo clonam; Marcelo só pode dias 07 e 14; limite 2 por pessoa → precisa de alocação exata
    s.employees.find((e) => e.id === 'em-ediane')!.skillIds = [];
    s.employees.find((e) => e.id === 'em-jose')!.skillIds = [];
    s.unavailability.push({ id: 'u1', employeeId: 'em-marcelo', startDate: '2026-11-21', endDate: '2026-11-30', reason: null });
    const r = gen(s);
    for (const d of r.days) expect(countActivities(d)[SKILL.clonagem]?.confirmed ?? 0).toBe(1);
    expect(r.valid).toBe(true);
  });

  it('5. pessoa com várias habilidades conta uma única vez e na atividade atribuída', () => {
    const s = seedSnapshot();
    const r = gen(s);
    const dayWithEdna = r.days.find((d) => d.members.some((m) => m.employeeId === 'em-edna'))!;
    const total = Object.values(countActivities(dayWithEdna)).reduce((n, c) => n + c.confirmed, 0);
    expect(total).toBe(dayWithEdna.members.length);
    const edna = dayWithEdna.members.find((m) => m.employeeId === 'em-edna')!;
    expect([SKILL.clonagem, SKILL.pos]).toContain(edna.activityId);
  });

  it('8. colaborador participa duas vezes no mesmo mês sem sábados consecutivos quando há alternativa', () => {
    const r = gen(seedSnapshot());
    const twice = r.distribution.filter((d) => d.month === 2);
    expect(twice.length).toBe(7);
    expect(r.summary.consecutive).toBe(0);
    expect(r.issues.filter((i) => i.code === 'consecutive')).toHaveLength(0);
  });

  it('9. equilíbrio entre meses: quem trabalhou menos em novembro tem prioridade em dezembro', () => {
    const { r: nov, s } = genAndSave(seedSnapshot());
    const lessInNov = nov.distribution.filter((d) => d.month === 1).map((d) => d.employeeId);
    const dec = gen(s, { year: 2026, month: 12 }); // dezembro/2026: 4 sábados
    for (const id of lessInNov) expect(dec.distribution.find((d) => d.employeeId === id)!.month).toBe(2);
    const lessInDec = dec.distribution.filter((d) => d.month === 1).map((d) => d.employeeId);
    expect(lessInDec.some((id) => lessInNov.includes(id))).toBe(false);
    const totals = dec.distribution.map((d) => d.total);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
  });

  it('10. entrada de novo colaborador: entra na distribuição sem ser sobrecarregado pelo histórico', () => {
    let { s } = genAndSave(seedSnapshot());
    s = genAndSave(s, { year: 2026, month: 12 }).s;
    s.employees.push({ ...s.employees[0], id: 'em-novo', fullName: 'Novo Colaborador', shortName: 'Novo Colab.', admissionDate: '2027-01-01', skillIds: [SKILL.cultivo] });
    const jan = gen(s, { year: 2027, month: 1 }); // 5 sábados × 4 = 20 vagas / 10 pessoas
    const novo = jan.distribution.find((d) => d.employeeId === 'em-novo')!;
    expect(novo.month).toBe(2);
    expect(Math.max(...countsOf(jan)) - Math.min(...countsOf(jan))).toBeLessThanOrEqual(1);
  });

  it('12. limite de quatro passageiros: nunca gera nem aceita mais que 4', () => {
    const r = gen(seedSnapshot(), NOV, { idealPerDay: 6 }); // ideal acima do limite é limitado
    for (const d of r.days) expect(d.members.length).toBeLessThanOrEqual(4);
    let s = commitMonth(seedSnapshot(), resultToCommit(r, 2026, 11));
    const day = r.days[0];
    const outsider = s.employees.find((e) => !day.members.some((m) => m.employeeId === e.id))!;
    expect(() => addAssignment(s, day.date, { employeeId: outsider.id, activityId: null, reservedLabel: null, requiredSkillId: null })).toThrow(DomainError);
    // validação acusa excesso de capacidade como erro obrigatório
    const views = dayViewsFor(s, 2026, 11);
    views[0].members.push({ key: 'x', employeeId: outsider.id, activityId: null, reservedLabel: null, requiredSkillId: null });
    expect(validateMonth(views, ctx(s)).some((i) => i.code === 'capacity' && i.severity === 'error')).toBe(true);
    s = setDayLocked(s, day.date, true);
    expect(s.workDays.find((w) => w.date === day.date)!.locked).toBe(true);
  });
});

describe('edição manual', () => {
  it('6. troca Marcelo (28/11) com Edna (14/11) e revalida cobertura e frequência', () => {
    let s = seedSnapshot();
    // Escala manual de referência do enunciado
    const plan: Record<string, string[]> = {
      '2026-11-07': ['Ediane', 'Ailton', 'David', 'Tatiana'],
      '2026-11-14': ['Edna', 'Emerson', 'Josenaldo', 'Ailton'],
      '2026-11-21': ['José', 'David', 'Emerson', 'Tatiana'],
      '2026-11-28': ['Marcelo', 'Josenaldo', 'Ediane', 'José'],
    };
    for (const [date, names] of Object.entries(plan))
      for (const n of names) {
        const e = s.employees.find((x) => x.shortName.startsWith(n))!;
        const act = e.skillIds.includes(SKILL.clonagem) ? SKILL.clonagem : e.skillIds[0];
        s = addAssignment(s, date, { employeeId: e.id, activityId: act, reservedLabel: null, requiredSkillId: null });
      }
    const a = s.assignments.find((x) => x.employeeId === idOf(s, 'Marcelo'))!;
    const b = s.assignments.find((x) => x.employeeId === idOf(s, 'Edna'))!;
    s = swapAssignments(s, a.id, b.id);
    const views = dayViewsFor(s, 2026, 11);
    expect(views.find((d) => d.date === '2026-11-14')!.members.some((m) => m.employeeId === idOf(s, 'Marcelo'))).toBe(true);
    expect(views.find((d) => d.date === '2026-11-28')!.members.some((m) => m.employeeId === idOf(s, 'Edna'))).toBe(true);
    for (const d of views) expect(countActivities(d)[SKILL.clonagem].confirmed).toBeGreaterThanOrEqual(1);
    expect(hasErrors(validateMonth(views, ctx(s)))).toBe(false);
    const stats = employeeStats(s, 2026, 11);
    expect(stats.find((x) => x.employee.id === idOf(s, 'Marcelo'))!.scheduledMonth).toBe(1);
  });

  it('troca é recusada se a pessoa já estiver no outro sábado', () => {
    let s = seedSnapshot();
    s = addAssignment(s, '2026-11-07', { employeeId: 'em-ailton', activityId: SKILL.cultivo, reservedLabel: null, requiredSkillId: null });
    s = addAssignment(s, '2026-11-07', { employeeId: 'em-david', activityId: SKILL.cultivo, reservedLabel: null, requiredSkillId: null });
    s = addAssignment(s, '2026-11-14', { employeeId: 'em-ailton', activityId: SKILL.cultivo, reservedLabel: null, requiredSkillId: null });
    const a = s.assignments.find((x) => x.employeeId === 'em-david')!;
    const b = s.assignments.filter((x) => x.employeeId === 'em-ailton')[1];
    expect(() => swapAssignments(s, a.id, b.id)).toThrow(/já está escalado/);
  });

  it('7. regeração parcial preserva sábados bloqueados', () => {
    let { s } = genAndSave(seedSnapshot());
    s = setDayLocked(s, '2026-11-07', true);
    s = setDayLocked(s, '2026-11-14', true);
    const before = dayViewsFor(s, 2026, 11).slice(0, 2).map((d) => d.members.map((m) => m.employeeId));
    // Marcelo entra de férias: os sábados restantes são regerados
    s.employees.find((e) => e.id === 'em-marcelo')!.status = 'vacation';
    const r = gen(s, NOV, { regenerateDates: ['2026-11-21', '2026-11-28'] });
    expect(r.days.filter((d) => d.regenerated).map((d) => d.date)).toEqual(['2026-11-21', '2026-11-28']);
    s = commitMonth(s, resultToCommit(r, 2026, 11));
    const after = dayViewsFor(s, 2026, 11);
    expect(after.slice(0, 2).map((d) => d.members.map((m) => m.employeeId))).toEqual(before);
    expect(after.slice(2).every((d) => !d.members.some((m) => m.employeeId === 'em-marcelo'))).toBe(true);
    expect(() => commitMonth(s, { year: 2026, month: 11, days: [{ date: '2026-11-07', startTime: '06:00', endTime: '09:00', members: [] }] })).toThrow(/bloqueado/);
  });

  it('11. vaga reservada é considerada pendente e depois preenchida sem refazer a escala', () => {
    let s = seedSnapshot();
    s = addAssignment(s, '2026-11-07', { employeeId: null, activityId: null, reservedLabel: 'Novo colaborador 1', requiredSkillId: SKILL.clonagem });
    const r = gen(s);
    const d7 = r.days[0];
    expect(d7.members.some((m) => m.reservedLabel === 'Novo colaborador 1')).toBe(true);
    expect(d7.members).toHaveLength(4);
    expect(countActivities(d7)[SKILL.clonagem].confirmed).toBeGreaterThanOrEqual(1); // vaga pendente não conta como cobertura
    s = commitMonth(s, resultToCommit(r, 2026, 11));
    s.employees.push({ ...s.employees[6], id: 'em-nova', fullName: 'Nova Clonadora', shortName: 'Nova C.', skillIds: [SKILL.clonagem] });
    const slot = s.assignments.find((a) => a.reservedLabel === 'Novo colaborador 1' && a.status === 'active')!;
    // pessoa sem a habilidade exigida é recusada
    expect(() => replaceAssignment(s, slot.id, 'em-ailton', SKILL.cultivo)).toThrow();
    const othersBefore = s.assignments.filter((a) => a.id !== slot.id).map((a) => a.id);
    s = replaceAssignment(s, slot.id, 'em-nova', SKILL.clonagem);
    const filled = dayViewsFor(s, 2026, 11)[0].members.find((m) => m.employeeId === 'em-nova')!;
    expect(filled.reservedLabel).toBe('Novo colaborador 1');
    expect(othersBefore.every((id) => s.assignments.some((a) => a.id === id))).toBe(true);
  });

  it('13. registro de ausência e substituição', () => {
    let { s } = genAndSave(seedSnapshot());
    const d7 = dayViewsFor(s, 2026, 11)[0];
    const absentId = d7.members.find((m) => m.activityId === SKILL.cultivo)!.key;
    const absentEmp = s.assignments.find((a) => a.id === absentId)!.employeeId!;
    s = setAttendance(s, absentId, 'absent');
    const free = s.employees.find((e) => e.skillIds.includes(SKILL.cultivo) && !d7.members.some((m) => m.employeeId === e.id))!;
    s = replaceAssignment(s, absentId, free.id, SKILL.cultivo);
    const original = s.assignments.find((a) => a.id === absentId)!;
    expect(original.status).toBe('replaced');
    expect(original.replacedById).toBeTruthy();
    const newOne = s.assignments.find((a) => a.id === original.replacedById)!;
    s = setAttendance(s, newOne.id, 'present');
    const st = employeeStats(s, 2026, 11);
    expect(st.find((x) => x.employee.id === absentEmp)!.replacedMonth).toBe(1);
    expect(st.find((x) => x.employee.id === free.id)!.presentMonth).toBe(1);
    expect(dayViewsFor(s, 2026, 11)[0].members).toHaveLength(4);
  });
});
