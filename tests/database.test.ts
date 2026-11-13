/**
 * Executa as migrations reais em um PostgreSQL embarcado (PGlite) com um esqueleto mínimo
 * do esquema "auth" do Supabase, e valida RLS, gatilhos e funções transacionais.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const SUPER = '00000000-0000-0000-0000-00000000000b';
const VIEWER = '00000000-0000-0000-0000-00000000000c';
let db: PGlite;

async function as<T = any>(user: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(user ? `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);` : `reset role;`);
  try {
    const r = await db.query(sql, params);
    return r.rows as T[];
  } finally {
    await db.exec('reset role;');
  }
}
const id = async (sql: string) => ((await as(null, sql))[0] as any).id as string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated nologin; create role anon nologin;
    create schema auth;
    grant usage on schema auth to authenticated;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to authenticated;
  `);
  const dir = join(__dirname, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ADMIN}', 'admin@x.com', '{"name":"Admin"}'),
      ('${SUPER}', 'sup@x.com', '{"name":"Supervisor","role":"supervisor"}'),
      ('${VIEWER}', 'ver@x.com', '{"name":"Quadro","role":"admin"}');
    update public.profiles set role = 'supervisor' where id = '${SUPER}'; -- como faz a função invite-user
  `);
}, 60_000);

describe('banco de dados (migrations + RLS)', () => {
  it('cria perfis: primeiro usuário admin; papel enviado no cadastro é ignorado', async () => {
    const rows = await as(null, 'select email, role from public.profiles order by email');
    expect(rows).toEqual([
      { email: 'admin@x.com', role: 'admin' },
      { email: 'sup@x.com', role: 'supervisor' },
      { email: 'ver@x.com', role: 'viewer' },
    ]);
  });

  it('seed: 9 colaboradores e 4 habilitados para clonagem', async () => {
    const [c] = await as(SUPER, 'select count(*)::int n from public.employees');
    expect(c.n).toBe(9);
    const cl = await as(SUPER, `select e.short_name from public.employees e join public.employee_skills es on es.employee_id = e.id join public.skills k on k.id = es.skill_id where k.name = 'Clonagem' order by 1`);
    expect(cl.map((r: any) => r.short_name).sort()).toEqual(['Ediane Macedo', 'Edna Gomes', 'José Ivan', 'Marcelo Pontes']);
  });

  it('commit_month, limite de transporte, duplicidade, troca e substituição', async () => {
    const clon = await id(`select id from public.skills where name = 'Clonagem'`);
    const cult = await id(`select id from public.skills where name = 'Cultivo'`);
    const e = async (n: string) => id(`select id from public.employees where short_name = '${n}'`);
    const [marcelo, edna, ailton, david, emerson, josenaldo, ediane] = await Promise.all(
      ['Marcelo Pontes', 'Edna Gomes', 'Ailton Ferreira', 'David Victor', 'Emerson Lucas', 'Josenaldo Neves', 'Ediane Macedo'].map(e));
    const m = (emp: string, act: string) => ({ employeeId: emp, activityId: act });
    const days = [
      { date: '2026-11-14', startTime: '06:00', endTime: '09:00', members: [m(edna, clon), m(ailton, cult), m(david, cult), m(emerson, cult)] },
      { date: '2026-11-28', startTime: '06:00', endTime: '09:00', members: [m(marcelo, clon), m(josenaldo, cult), m(ediane, clon)] },
    ];
    await as(SUPER, 'select public.commit_month(2026, 11, $1::jsonb)', [JSON.stringify(days)]);
    const [n] = await as(SUPER, `select count(*)::int n from public.assignments where status = 'active'`);
    expect(n.n).toBe(7);

    // quinto passageiro é recusado
    await expect(as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', ['2026-11-14', josenaldo, cult])).rejects.toThrow(/Limite de transporte/);
    // duplicidade é recusada pelo índice único
    await expect(as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', ['2026-11-28', marcelo, clon])).rejects.toThrow(/duplicate|unique/i);
    // atividade sem habilidade é recusada
    await expect(as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', ['2026-11-28', ailton, clon])).rejects.toThrow(/habilitado/);
    // data que não é sábado
    await expect(as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', ['2026-11-13', ailton, cult])).rejects.toThrow(/sábado/);

    // troca Marcelo (28/11) ↔ Edna (14/11)
    const aM = await id(`select a.id from public.assignments a where a.employee_id = '${marcelo}' and status = 'active'`);
    const aE = await id(`select a.id from public.assignments a where a.employee_id = '${edna}' and status = 'active'`);
    await as(SUPER, 'select public.swap_assignments($1, $2)', [aM, aE]);
    const after = await as(null, `select w.date::text d, e.short_name n from public.assignments a join public.work_days w on w.id = a.work_day_id join public.employees e on e.id = a.employee_id where e.short_name in ('Marcelo Pontes','Edna Gomes') and a.status='active' order by 1`);
    expect(after).toEqual([{ d: '2026-11-14', n: 'Marcelo Pontes' }, { d: '2026-11-28', n: 'Edna Gomes' }]);

    // substituição em sábado bloqueado é permitida e preserva o histórico
    await as(SUPER, `update public.work_days set locked = true where date = '2026-11-14'`);
    await expect(as(SUPER, `delete from public.assignments where id = '${aE}'`)).rejects.toThrow(/bloqueado/);
    await as(SUPER, `update public.assignments set attendance = 'absent' where employee_id = '${ailton}'`);
    const newId = (await as(SUPER, 'select public.replace_assignment($1, $2, $3) id', [
      await id(`select id from public.assignments where employee_id = '${ailton}'`), josenaldo, cult,
    ]))[0].id;
    const [old] = await as(null, `select status, attendance, replaced_by_id from public.assignments where employee_id = '${ailton}'`);
    expect(old).toEqual({ status: 'replaced', attendance: 'absent', replaced_by_id: newId });

    // auditoria registrou quem alterou
    const log = await as(SUPER, `select user_name, summary from public.audit_log where entity = 'assignments' and summary = 'Substituição' limit 1`);
    expect(log[0].user_name).toBe('Supervisor');
  });

  it('publicação exige restrições obrigatórias atendidas', async () => {
    const sid = await id(`select id from public.schedules where year = 2026 and month = 11`);
    // remove a clonagem de 28/11 e tenta publicar
    await as(SUPER, `delete from public.assignments a using public.work_days w, public.skills k where w.id = a.work_day_id and w.date = '2026-11-28' and k.id = a.activity_id and k.name = 'Clonagem'`);
    await expect(as(SUPER, `update public.schedules set status = 'published' where id = '${sid}'`)).rejects.toThrow(/não pode ser publicada.*Clonagem/);
    const clon = await id(`select id from public.skills where name = 'Clonagem'`);
    const jose = await id(`select id from public.employees where short_name = 'José Ivan'`);
    await as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', ['2026-11-28', jose, clon]);
    await as(SUPER, `update public.schedules set status = 'published' where id = '${sid}'`);
    const [s] = await as(null, `select status, published_at is not null p from public.schedules where id = '${sid}'`);
    expect(s).toEqual({ status: 'published', p: true });
  });

  it('visualizador: só lê escalas publicadas e nunca dados internos', async () => {
    await as(SUPER, `select public.ensure_work_day('2026-12-05')`); // rascunho de dezembro
    const sch = await as(VIEWER, 'select year, month from public.schedules order by month');
    expect(sch).toEqual([{ year: 2026, month: 11 }]);
    const ws = await as(VIEWER, `select count(*)::int n from public.work_days`);
    expect(ws[0].n).toBe(2);
    await as(null, `insert into public.employee_private (employee_id, admin_notes) select id, 'nota interna' from public.employees limit 1`);
    expect(await as(VIEWER, 'select * from public.employee_private')).toHaveLength(0);
    expect(await as(VIEWER, 'select * from public.unavailability')).toHaveLength(0);
    expect(await as(VIEWER, 'select * from public.audit_log')).toHaveLength(0);
    await expect(as(VIEWER, `select public.ensure_work_day('2026-12-12')`)).rejects.toThrow(/Permissão/);
    await as(VIEWER, `update public.employees set short_name = 'Hack'`); // RLS: sem efeito
    const [c] = await as(null, `select count(*)::int n from public.employees where short_name = 'Hack'`);
    expect(c.n).toBe(0);
  });

  it('supervisor não altera colaboradores nem perfis; admin sim', async () => {
    await expect(as(SUPER, `select public.save_employee('{"fullName":"Fulano de Tal","shortName":"Fulano","skillIds":[]}'::jsonb)`)).rejects.toThrow(/administradores/);
    await expect(as(SUPER, `update public.profiles set role = 'admin' where id = '${SUPER}'`)).rejects.toThrow(/administradores/);
    const cult = await id(`select id from public.skills where name = 'Cultivo'`);
    const [r] = await as(ADMIN, `select public.save_employee($1::jsonb) id`, [JSON.stringify({ fullName: 'Novo Colaborador Teste', shortName: 'Novo T.', status: 'active', skillIds: [cult], adminNotes: 'interno' })]);
    const sk = await as(ADMIN, `select count(*)::int n from public.employee_skills where employee_id = '${r.id}'`);
    expect(sk[0].n).toBe(1);
    await expect(as(ADMIN, `update public.profiles set role = 'viewer' where id = '${ADMIN}'`)).rejects.toThrow(/pelo menos um administrador/);
  });

  it('encerrar a escala bloqueia sábados e impede alterações', async () => {
    const sid = await id(`select id from public.schedules where year = 2026 and month = 11`);
    await as(ADMIN, `update public.schedules set status = 'closed' where id = '${sid}'`);
    const [w] = await as(null, `select bool_and(locked) l from public.work_days where schedule_id = '${sid}'`);
    expect(w.l).toBe(true);
    await expect(as(ADMIN, `update public.assignments set attendance = 'present' where status = 'active'`)).rejects.toThrow(/encerrada/);
  });

  it('relatório calculado a partir dos registros', async () => {
    const rows = await as(SUPER, `select short_name, scheduled::int, replaced::int, absent::int from public.v_employee_month_stats where year = 2026 and month = 11 and short_name = 'Ailton Ferreira'`);
    expect(rows[0]).toEqual({ short_name: 'Ailton Ferreira', scheduled: 0, replaced: 1, absent: 0 });
  });

  it('datas extras e banco de cotas (migration 0005)', async () => {
    const clon = await id(`select id from public.skills where name = 'Clonagem'`);
    const cult = await id(`select id from public.skills where name = 'Cultivo'`);
    const e = async (n: string) => id(`select id from public.employees where short_name = '${n}'`);
    const [ediane, marcelo, ailton] = await Promise.all(['Ediane Macedo', 'Marcelo Pontes', 'Ailton Ferreira'].map(e));
    // segunda-feira sem cadastro de data extra é recusada; com cadastro, aceita
    await expect(as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', ['2027-01-04', ailton, cult])).rejects.toThrow(/data extra/);
    await as(SUPER, 'select public.save_extra_day($1, $2, $3, $4, $5, $6, $7::jsonb)', ['2027-01-04', 'Rega pós-feriado', '07:00', '09:00', 2, true, JSON.stringify([{ skillId: cult, minCount: 1, mandatory: true }])]);
    await as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', ['2027-01-04', ailton, cult]);
    // cotas: Ediane 2, Marcelo 2, Ailton 1 (já usado no feriado)
    await as(SUPER, 'select public.set_quotas(2027, 1, $1::jsonb, true)', [JSON.stringify({ [ediane]: 2, [marcelo]: 2, [ailton]: 1 })]);
    for (const d of ['2027-01-09', '2027-01-23']) await as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', [d, ediane, clon]);
    await expect(as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', ['2027-01-30', ediane, clon])).rejects.toThrow(/Cota de Ediane Macedo esgotada \(2 de 2\)/);
    await expect(as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', ['2027-01-09', ailton, cult])).rejects.toThrow(/esgotada/);
    await expect(as(SUPER, 'select public.set_quotas(2027, 1, $1::jsonb, true)', [JSON.stringify({ [ediane]: 1 })])).rejects.toThrow(/não pode ser menor/);
    // troca com cotas cheias não altera totais e é aceita
    for (const d of ['2027-01-16', '2027-01-30']) await as(SUPER, 'select public.add_assignment($1, $2, $3, null, null)', [d, marcelo, clon]);
    const a = await id(`select a.id from public.assignments a join public.work_days w on w.id = a.work_day_id where w.date = '2027-01-09' and a.employee_id = '${ediane}'`);
    const b = await id(`select a.id from public.assignments a join public.work_days w on w.id = a.work_day_id where w.date = '2027-01-16' and a.employee_id = '${marcelo}'`);
    await as(SUPER, 'select public.swap_assignments($1, $2)', [a, b]);
    const [u] = await as(null, `select public.quota_used(s.id, '${ediane}') e, public.quota_used(s.id, '${marcelo}') m from public.schedules s where year = 2027 and month = 1`);
    expect(u).toEqual({ e: 2, m: 2 });
    // validação para publicar considera os requisitos da data extra e dos sábados
    const sid = await id(`select id from public.schedules where year = 2027 and month = 1`);
    const probs = await as(SUPER, `select problem from public.schedule_problems('${sid}')`);
    expect(probs.some((p: any) => /04\/01/.test(p.problem))).toBe(false);
    await as(SUPER, 'select public.save_extra_day($1, $2, $3, $4, $5, $6, $7::jsonb)', ['2027-01-04', 'Rega pós-feriado', '07:00', '09:00', 2, true, JSON.stringify([{ skillId: cult, minCount: 2, mandatory: true }])]);
    const probs2 = await as(SUPER, `select problem from public.schedule_problems('${sid}')`);
    expect(probs2.some((p: any) => /04\/01: Cultivo com 1 de 2/.test(p.problem))).toBe(true);
    // remove a data extra
    await as(SUPER, `select public.remove_extra_day('2027-01-04')`);
    const [c] = await as(null, `select count(*)::int n from public.work_days where date = '2027-01-04'`);
    expect(c.n).toBe(0);
  });
});

