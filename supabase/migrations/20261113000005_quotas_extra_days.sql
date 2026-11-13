-- =====================================================================
-- Banco de cotas mensais + datas extraordinárias (feriados, rega etc.)
-- =====================================================================

-- Datas extraordinárias: work_days deixa de exigir sábado quando kind = 'extra'
alter table public.work_days drop constraint if exists work_days_date_check;
alter table public.work_days
  add column kind text not null default 'regular' check (kind in ('regular', 'extra')),
  add column label text check (label is null or length(label) <= 80),
  add column counts_in_quota boolean not null default true,
  add column ideal_size int check (ideal_size is null or ideal_size between 1 and 30),
  add column requirements jsonb;
alter table public.work_days
  add constraint work_days_regular_is_saturday check (kind = 'extra' or extract(isodow from date) = 6);

-- Cotas individuais por mês
alter table public.schedules add column use_quotas boolean not null default false;

create table public.monthly_quotas (
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  quota int not null check (quota between 0 and 10),
  primary key (schedule_id, employee_id)
);

alter table public.monthly_quotas enable row level security;
grant select, insert, update, delete on public.monthly_quotas to authenticated;
create policy monthly_quotas_select on public.monthly_quotas for select to authenticated using (public.is_editor());
create policy monthly_quotas_write on public.monthly_quotas for all to authenticated
  using (public.is_editor()) with check (public.is_editor());
create trigger monthly_quotas_audit after insert or update or delete on public.monthly_quotas
  for each row execute function public.audit_row();

-- Participações que contam na cota (exclui uma participação, se informada)
create or replace function public.quota_used(p_schedule uuid, p_employee uuid, p_exclude uuid default null)
returns int language sql stable set search_path = public as $$
  select count(*)::int from public.assignments a
  join public.work_days w on w.id = a.work_day_id
  where w.schedule_id = p_schedule and w.counts_in_quota and a.status = 'active'
    and a.employee_id = p_employee and a.id is distinct from p_exclude
$$;

-- Gatilho: não ultrapassar a cota mensal quando o banco de cotas está ativo
create or replace function public.check_quota()
returns trigger language plpgsql set search_path = public as $$
declare
  w public.work_days;
  s public.schedules;
  q int;
  used int;
  nm text;
begin
  if new.status <> 'active' or new.employee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.employee_id is not distinct from old.employee_id
     and new.work_day_id is not distinct from old.work_day_id and old.status = 'active' then
    return new;
  end if;
  if coalesce(current_setting('app.skip_quota', true), '') = 'on' then return new; end if;
  select * into w from public.work_days where id = new.work_day_id;
  if not w.counts_in_quota then return new; end if;
  select * into s from public.schedules where id = w.schedule_id;
  if not s.use_quotas then return new; end if;
  select coalesce((select quota from public.monthly_quotas where schedule_id = s.id and employee_id = new.employee_id), 0) into q;
  used := public.quota_used(s.id, new.employee_id, new.id);
  if used + 1 > q then
    select short_name into nm from public.employees where id = new.employee_id;
    raise exception 'Cota de % esgotada (% de %). Aumente a cota ou mova uma participação existente.', nm, used, q;
  end if;
  return new;
end $$;
create trigger assignments_quota before insert or update on public.assignments
  for each row execute function public.check_quota();

-- Dias de trabalho: datas extras já cadastradas são aceitas; demais precisam ser sábado
create or replace function public.ensure_work_day(p_date date)
returns public.work_days language plpgsql set search_path = public as $$
declare
  v_schedule uuid;
  v_day public.work_days;
  st public.settings;
begin
  perform public.require_editor();
  select * into v_day from public.work_days where date = p_date;
  if v_day.id is not null then return v_day; end if;
  if extract(isodow from p_date) <> 6 then
    raise exception 'A data % não é um sábado. Cadastre-a como data extra.', to_char(p_date, 'DD/MM/YYYY');
  end if;
  select * into st from public.settings where id = 1;
  insert into public.schedules (year, month, created_by)
  values (extract(year from p_date), extract(month from p_date), auth.uid())
  on conflict (year, month) do nothing;
  select id into v_schedule from public.schedules
    where year = extract(year from p_date) and month = extract(month from p_date);
  insert into public.work_days (schedule_id, date, start_time, end_time)
  values (v_schedule, p_date, st.start_time, st.end_time)
  on conflict (date) do nothing;
  select * into v_day from public.work_days where date = p_date;
  return v_day;
end $$;

create or replace function public.save_extra_day(
  p_date date, p_label text, p_start time, p_end time, p_ideal int, p_counts boolean, p_requirements jsonb)
returns uuid language plpgsql set search_path = public as $$
declare
  v_schedule uuid;
  v_day public.work_days;
begin
  perform public.require_editor();
  select * into v_day from public.work_days where date = p_date;
  if v_day.id is not null and v_day.kind = 'regular' then
    raise exception 'O dia % já é um sábado regular da escala.', to_char(p_date, 'DD/MM');
  end if;
  insert into public.schedules (year, month, created_by)
  values (extract(year from p_date), extract(month from p_date), auth.uid())
  on conflict (year, month) do nothing;
  select id into v_schedule from public.schedules
    where year = extract(year from p_date) and month = extract(month from p_date);
  if v_day.id is null then
    insert into public.work_days (schedule_id, date, start_time, end_time, kind, label, counts_in_quota, ideal_size, requirements)
    values (v_schedule, p_date, p_start, p_end, 'extra', nullif(trim(p_label), ''), p_counts, p_ideal, coalesce(p_requirements, '[]'::jsonb))
    returning * into v_day;
  else
    update public.work_days set start_time = p_start, end_time = p_end, label = nullif(trim(p_label), ''),
      counts_in_quota = p_counts, ideal_size = p_ideal, requirements = coalesce(p_requirements, '[]'::jsonb)
    where id = v_day.id returning * into v_day;
  end if;
  return v_day.id;
end $$;

create or replace function public.remove_extra_day(p_date date)
returns void language plpgsql set search_path = public as $$
begin
  perform public.require_editor();
  perform set_config('app.audit_summary', 'Data extra removida', true);
  delete from public.assignments a using public.work_days w
    where w.id = a.work_day_id and w.date = p_date and w.kind = 'extra';
  delete from public.work_days where date = p_date and kind = 'extra';
end $$;

-- Define as cotas do mês (e liga/desliga o banco de cotas)
create or replace function public.set_quotas(p_year int, p_month int, p_quotas jsonb, p_enable boolean)
returns void language plpgsql set search_path = public as $$
declare
  v_schedule uuid;
  r record;
  used int;
  nm text;
begin
  perform public.require_editor();
  insert into public.schedules (year, month, created_by) values (p_year, p_month, auth.uid())
  on conflict (year, month) do nothing;
  select id into v_schedule from public.schedules where year = p_year and month = p_month;
  for r in select key::uuid as employee_id, value::int as quota from jsonb_each_text(p_quotas) loop
    used := public.quota_used(v_schedule, r.employee_id, null);
    if p_enable and r.quota < used then
      select short_name into nm from public.employees where id = r.employee_id;
      raise exception 'A cota de % não pode ser menor que as % participação(ões) já colocadas. Remova ou mova antes.', nm, used;
    end if;
    insert into public.monthly_quotas (schedule_id, employee_id, quota) values (v_schedule, r.employee_id, r.quota)
    on conflict (schedule_id, employee_id) do update set quota = excluded.quota;
  end loop;
  update public.schedules set use_quotas = p_enable where id = v_schedule;
end $$;

-- Troca entre datas não altera o total de ninguém: dispensa a checagem de cota
create or replace function public.swap_assignments(p_a uuid, p_b uuid)
returns void language plpgsql set search_path = public as $$
declare
  a public.assignments;
  b public.assignments;
  wa public.work_days;
  wb public.work_days;
  act_a uuid;
  act_b uuid;
begin
  perform public.require_editor();
  select * into a from public.assignments where id = p_a and status = 'active' for update;
  select * into b from public.assignments where id = p_b and status = 'active' for update;
  if a.id is null or b.id is null then raise exception 'Participação não encontrada.'; end if;
  if a.work_day_id = b.work_day_id then raise exception 'As duas pessoas já estão no mesmo dia.'; end if;
  if b.employee_id is not null and exists (select 1 from public.assignments where work_day_id = a.work_day_id and employee_id = b.employee_id and status = 'active') then
    raise exception 'O colaborador já está escalado no dia de destino.';
  end if;
  if a.employee_id is not null and exists (select 1 from public.assignments where work_day_id = b.work_day_id and employee_id = a.employee_id and status = 'active') then
    raise exception 'O colaborador já está escalado no dia de destino.';
  end if;
  select * into wa from public.work_days where id = a.work_day_id;
  select * into wb from public.work_days where id = b.work_day_id;
  act_a := case when a.activity_id is not null and exists (select 1 from public.employee_skills where employee_id = b.employee_id and skill_id = a.activity_id) then a.activity_id else b.activity_id end;
  act_b := case when b.activity_id is not null and exists (select 1 from public.employee_skills where employee_id = a.employee_id and skill_id = b.activity_id) then b.activity_id else a.activity_id end;
  perform set_config('app.audit_summary', 'Troca entre datas', true);
  if wa.counts_in_quota = wb.counts_in_quota then
    perform set_config('app.skip_quota', 'on', true);
  end if;
  update public.assignments set employee_id = a.employee_id, reserved_label = a.reserved_label, required_skill_id = a.required_skill_id, activity_id = act_b, attendance = null where id = b.id;
  update public.assignments set employee_id = b.employee_id, reserved_label = b.reserved_label, required_skill_id = b.required_skill_id, activity_id = act_a, attendance = null where id = a.id;
  perform set_config('app.skip_quota', '', true);
end $$;

-- Validação para publicar: requisitos próprios das datas extras
create or replace function public.schedule_problems(p_schedule uuid)
returns table (date date, problem text) language sql stable set search_path = public as $$
  with reqs as (
    select w.id as work_day_id, w.date, (r ->> 'skillId')::uuid as skill_id, (r ->> 'minCount')::int as min_count
    from public.work_days w
    cross join lateral jsonb_array_elements(w.requirements) r
    where w.schedule_id = p_schedule and w.requirements is not null and coalesce((r ->> 'mandatory')::boolean, true)
    union all
    select w.id, w.date, ar.skill_id, ar.min_count
    from public.work_days w cross join public.activity_requirements ar
    where w.schedule_id = p_schedule and w.requirements is null and ar.mandatory
  )
  select q.date, format('%s: %s com %s de %s pessoa(s) obrigatória(s)', to_char(q.date, 'DD/MM'), k.name, coalesce(c.n, 0), q.min_count)
  from reqs q
  join public.skills k on k.id = q.skill_id
  left join lateral (
    select count(*) n from public.assignments a
    where a.work_day_id = q.work_day_id and a.status = 'active' and a.employee_id is not null and a.activity_id = q.skill_id
  ) c on true
  where q.min_count > 0 and coalesce(c.n, 0) < q.min_count
  union all
  select w.date, format('%s: %s pessoas acima do limite de transporte', to_char(w.date, 'DD/MM'), count(*))
  from public.work_days w join public.assignments a on a.work_day_id = w.id and a.status = 'active'
  where w.schedule_id = p_schedule
  group by w.date
  having count(*) > (select max_per_day from public.settings where id = 1)
  order by 1
$$;

grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema public from anon;
