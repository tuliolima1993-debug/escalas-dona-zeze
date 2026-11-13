/** Construtor com banco de cotas e datas extraordinárias — critérios de aceitação. */
import { describe, expect, it } from 'vitest';
import { buildGenerateInput, resultToCommit, suggestQuotas } from '../src/domain/generate-input';
import {
  addAssignment, commitMonth, moveAssignment, removeAssignment, removeExtraDay, saveExtraDay, setQuotas,
  setScheduleStatus, swapAssignments, DomainError,
} from '../src/domain/mutations';
import { generateSchedule } from '../src/domain/scheduler';
import { seedSnapshot, SKILL } from '../src/domain/seed';
import { countActivities, validateMonth, hasErrors } from '../src/domain/validate';
import { dayViewsFor, quotaUsage, quotasFor, dashboardKpis } from '../src/domain/stats';
import type { Snapshot } from '../src/domain/types';

const Y = 2026, M = 11; // 07, 14, 21, 28
const put = (s: Snapshot, date: string, emp: string, act: string) =>
  addAssignment(s, date, { employeeId: emp, activityId: act, reservedLabel: null, requiredSkillId: null });
const withQuotas = () => {
  const s = seedSnapshot();
  const { quotas } = suggestQuotas(s, Y, M);
  return setQuotas(s, Y, M, quotas, true);
};
const idOn = (s: Snapshot, date: string, emp: string) => {
  const wd = s.workDays.find((w) => w.date === date)!;
  return s.assignments.find((a) => a.workDayId === wd.id && a.employeeId === emp && a.status === 'active')!.id;
};
const ctx = (s: Snapshot) => ({
  employees: s.employees, skills: s.skills, unavailability: s.unavailability, requirements: s.requirements, settings: s.settings,
  quotas: quotasFor(s, Y, M),
});

describe('banco de cotas', () => {
  it('sugere 16 participações equilibradas (7×2 + 2×1) e compara com o total de vagas', () => {
    const { quotas, total } = suggestQuotas(seedSnapshot(), Y, M);
    const values = Object.values(quotas);
    expect(total).toBe(16);
    expect(values.reduce((a, b) => a + b, 0)).toBe(16);
    expect(values.filter((v) => v === 2)).toHaveLength(7);
    expect(values.filter((v) => v === 1)).toHaveLength(2);
  });

  it('1. Ediane com cota 2: entra em exatamente duas datas e é bloqueada na terceira', () => {
    let s = setQuotas(seedSnapshot(), Y, M, { 'em-ediane': 2 }, true);
    s = put(s, '2026-11-07', 'em-ediane', SKILL.clonagem);
    s = put(s, '2026-11-21', 'em-ediane', SKILL.clonagem);
    expect(quotaUsage(s, Y, M)['em-ediane']).toBe(2);
    expect(() => put(s, '2026-11-28', 'em-ediane', SKILL.clonagem)).toThrow(/Cota de Ediane Macedo esgotada \(2 de 2\)/);
  });

  it('2. ao remover Ediane de uma data, ela volta a ter uma participação disponível', () => {
    let s = setQuotas(seedSnapshot(), Y, M, { 'em-ediane': 2 }, true);
    s = put(s, '2026-11-07', 'em-ediane', SKILL.clonagem);
    s = put(s, '2026-11-21', 'em-ediane', SKILL.clonagem);
    s = removeAssignment(s, idOn(s, '2026-11-07', 'em-ediane'));
    expect(quotaUsage(s, Y, M)['em-ediane']).toBe(1);
    s = put(s, '2026-11-28', 'em-ediane', SKILL.clonagem);
    expect(quotaUsage(s, Y, M)['em-ediane']).toBe(2);
  });

  it('3. transferir Ediane de um sábado para outro mantém a cota utilizada', () => {
    let s = setQuotas(seedSnapshot(), Y, M, { 'em-ediane': 2, 'em-marcelo': 2 }, true);
    s = put(s, '2026-11-07', 'em-ediane', SKILL.clonagem);
    s = put(s, '2026-11-21', 'em-ediane', SKILL.clonagem);
    s = moveAssignment(s, idOn(s, '2026-11-07', 'em-ediane'), '2026-11-14');
    expect(quotaUsage(s, Y, M)['em-ediane']).toBe(2);
    // troca entre datas com cotas cheias também não muda totais
    s = put(s, '2026-11-28', 'em-marcelo', SKILL.clonagem);
    s = put(s, '2026-11-07', 'em-marcelo', SKILL.clonagem);
    s = swapAssignments(s, idOn(s, '2026-11-14', 'em-ediane'), idOn(s, '2026-11-28', 'em-marcelo'));
    expect(quotaUsage(s, Y, M)).toMatchObject({ 'em-ediane': 2, 'em-marcelo': 2 });
  });

  it('4 e 5. cota de Marcelo sobe de 2 para 3; não pode descer abaixo do já utilizado', () => {
    let s = setQuotas(seedSnapshot(), Y, M, { 'em-marcelo': 2 }, true);
    s = put(s, '2026-11-07', 'em-marcelo', SKILL.clonagem);
    s = put(s, '2026-11-21', 'em-marcelo', SKILL.clonagem);
    s = setQuotas(s, Y, M, { 'em-marcelo': 3 }, true);
    s = put(s, '2026-11-28', 'em-marcelo', SKILL.clonagem);
    expect(quotaUsage(s, Y, M)['em-marcelo']).toBe(3);
    expect(() => setQuotas(s, Y, M, { 'em-marcelo': 2 }, true)).toThrow(/não pode ser menor que as 3/);
  });

  it('6. soma das cotas comparada ao total de vagas', () => {
    const s = withQuotas();
    const q = quotasFor(s, Y, M)!;
    const k = dashboardKpis(s, Y, M, [SKILL.clonagem]);
    expect(Object.values(q).reduce((a, b) => a + b, 0)).toBe(k.capacity);
  });

  it('pessoa sem cota no mês não pode ser escalada enquanto o banco estiver ativo', () => {
    const s = setQuotas(seedSnapshot(), Y, M, { 'em-ediane': 2 }, true);
    expect(() => put(s, '2026-11-07', 'em-david', SKILL.cultivo)).toThrow(DomainError);
  });

  it('preenchimento automático respeita as cotas definidas pelo administrador', () => {
    let s = withQuotas();
    const base = quotasFor(s, Y, M)!;
    // Marcelo +1; tira 1 de quem tinha 2 para a soma continuar igual às 16 vagas
    const donor = Object.keys(base).find((id) => id !== 'em-marcelo' && base[id] === 2 && !['em-ediane', 'em-jose', 'em-edna'].includes(id))!;
    const q = { ...base, 'em-marcelo': base['em-marcelo'] + 1, [donor]: 1 };
    expect(Object.values(q).reduce((a, b) => a + b, 0)).toBe(16);
    s = setQuotas(s, Y, M, q, true);
    const r = generateSchedule(buildGenerateInput(s, Y, M));
    s = commitMonth(s, resultToCommit(r, Y, M));
    const used = quotaUsage(s, Y, M);
    for (const [id, quota] of Object.entries(q)) expect(used[id] ?? 0).toBeLessThanOrEqual(quota);
    expect(used['em-marcelo']).toBe(q['em-marcelo']);
    expect(Object.values(used).reduce((a, b) => a + b, 0)).toBe(16);
  });
});

describe('datas extraordinárias', () => {
  const finados = { date: '2026-11-02', label: 'Finados — manutenção de rega', startTime: '07:00', endTime: '09:00', idealSize: 2, countsInQuota: true, requirements: [] };

  it('7 e 8. cria jornada extra em 02/11 (segunda) com horário e equipe próprios', () => {
    let s = saveExtraDay(seedSnapshot(), finados);
    const days = dayViewsFor(s, Y, M);
    expect(days.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
    const d2 = days[0];
    expect(d2).toMatchObject({ kind: 'extra', startTime: '07:00', endTime: '09:00', idealSize: 2, label: 'Finados — manutenção de rega' });
    s = put(s, '2026-11-02', 'em-ailton', SKILL.cultivo);
    s = put(s, '2026-11-02', 'em-david', SKILL.cultivo);
    expect(dayViewsFor(s, Y, M)[0].members).toHaveLength(2);
    // feriado sem obrigatoriedade de clonagem (atividades próprias)
    const issues = validateMonth(dayViewsFor(s, Y, M).slice(0, 1), ctx(s));
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    // não confunde segunda-feira com "sábado seguido"
    s = put(s, '2026-11-07', 'em-ailton', SKILL.cultivo);
    expect(validateMonth(dayViewsFor(s, Y, M), ctx(s)).some((i) => i.code === 'consecutive')).toBe(false);
  });

  it('9. feriado conta na cota ou separado, conforme configurado', () => {
    let s = setQuotas(saveExtraDay(seedSnapshot(), finados), Y, M, { 'em-ailton': 1 }, true);
    s = put(s, '2026-11-02', 'em-ailton', SKILL.cultivo);
    expect(() => put(s, '2026-11-07', 'em-ailton', SKILL.cultivo)).toThrow(/esgotada/);
    let t = setQuotas(saveExtraDay(seedSnapshot(), { ...finados, countsInQuota: false }), Y, M, { 'em-ailton': 1 }, true);
    t = put(t, '2026-11-02', 'em-ailton', SKILL.cultivo);
    t = put(t, '2026-11-07', 'em-ailton', SKILL.cultivo);
    expect(quotaUsage(t, Y, M)['em-ailton']).toBe(1);
  });

  it('o motor preenche também a data extra e o total de vagas inclui o feriado', () => {
    const s = saveExtraDay(seedSnapshot(), { ...finados, requirements: [{ skillId: SKILL.cultivo, minCount: 1, mandatory: true }] });
    const { total } = suggestQuotas(s, Y, M);
    expect(total).toBe(18);
    const r = generateSchedule(buildGenerateInput(s, Y, M, { maxPerMonth: 3 }));
    const d2 = r.days.find((d) => d.date === '2026-11-02')!;
    expect(d2.members).toHaveLength(2);
    expect(countActivities(d2)[SKILL.cultivo].confirmed).toBeGreaterThanOrEqual(1);
    expect(r.valid).toBe(true);
  });

  it('remove a data extra com sua equipe', () => {
    let s = put(saveExtraDay(seedSnapshot(), finados), '2026-11-02', 'em-ailton', SKILL.cultivo);
    s = removeExtraDay(s, '2026-11-02');
    expect(dayViewsFor(s, Y, M)).toHaveLength(4);
    expect(s.assignments).toHaveLength(0);
  });
});

describe('regras gerais do construtor', () => {
  it('10, 11. mesma pessoa duas vezes na data e capacidade máxima são recusadas', () => {
    let s = withQuotas();
    s = put(s, '2026-11-07', 'em-ediane', SKILL.clonagem);
    expect(() => put(s, '2026-11-07', 'em-ediane', SKILL.clonagem)).toThrow(/já está escalado/);
    for (const id of ['em-ailton', 'em-david', 'em-emerson']) s = put(s, '2026-11-07', id, SKILL.cultivo);
    expect(() => put(s, '2026-11-07', 'em-josenaldo', SKILL.cultivo)).toThrow(/Limite de transporte/);
  });

  it('12. indicadores refletem a atividade atribuída (Edna como Clonagem conta em Clonagem)', () => {
    let s = withQuotas();
    s = put(s, '2026-11-07', 'em-edna', SKILL.clonagem);
    s = put(s, '2026-11-07', 'em-tatiana', SKILL.pos);
    const c = countActivities(dayViewsFor(s, Y, M)[0]);
    expect(c[SKILL.clonagem].confirmed).toBe(1);
    expect(c[SKILL.pos].confirmed).toBe(1);
  });

  it('13 e 14. rascunho incompleto é salvo; publicação inválida é recusada', () => {
    let s = withQuotas();
    s = put(s, '2026-11-07', 'em-ailton', SKILL.cultivo);
    expect(s.schedules[0].status).toBe('draft');
    expect(hasErrors(validateMonth(dayViewsFor(s, Y, M), ctx(s)))).toBe(true);
    expect(() => setScheduleStatus(s, Y, M, 'published')).toThrow(/não pode ser publicada/);
  });

  it('15. novo colaborador cadastrado não altera escala publicada', () => {
    let s = seedSnapshot();
    const r = generateSchedule(buildGenerateInput(s, Y, M));
    s = setScheduleStatus(commitMonth(s, resultToCommit(r, Y, M)), Y, M, 'published');
    const before = JSON.stringify(dayViewsFor(s, Y, M).map((d) => d.members));
    s = { ...s, employees: [...s.employees, { ...s.employees[0], id: 'em-novo', fullName: 'Novo Colaborador', shortName: 'Novo C.' }] };
    expect(JSON.stringify(dayViewsFor(s, Y, M).map((d) => d.members))).toBe(before);
  });
});
