-- =====================================================================
-- Funções, gatilhos de integridade, auditoria e operações transacionais
-- =====================================================================

-- Perfis --------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'supervisor') from public.profiles where id = auth.uid()), false)
$$;

-- Novo usuário do Auth => perfil. O primeiro usuário vira administrador; os demais entram como
-- visualizadores (o papel informado no cadastro NÃO é confiável e é ignorado). O papel de usuários
-- convidados é ajustado pela função serverless invite-user ou por um administrador na tela Usuários.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role := 'viewer';
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  end if;
  insert into public.profiles (id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), coalesce(new.email, ''), v_role)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Somente administradores mudam papéis; ninguém se rebaixa sendo o último admin.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    -- chamadas de servidor (service_role / migrations) não têm auth.uid()
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Apenas administradores podem alterar perfis de acesso.';
    end if;
    if old.role = 'admin' and (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception 'É necessário manter pelo menos um administrador.';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

-- updated_at ---------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger employees_touch before update on public.employees for each row execute function public.touch_updated_at();
create trigger assignments_touch before update on public.assignments for each row execute function public.touch_updated_at();
create trigger schedules_touch before update on public.schedules for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- Auditoria genérica (versão anterior e atual de cada registro) --------------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_id uuid;
begin
  if tg_op = 'UPDATE' and (v_before - 'updated_at') = (v_after - 'updated_at') then
    return new;
  end if;
  begin
    v_id := coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'employee_id', v_before ->> 'employee_id', v_after ->> 'skill_id', v_before ->> 'skill_id')::uuid;
  exception when others then
    v_id := null;
  end;
  insert into public.audit_log (user_id, user_name, entity, entity_id, action, summary, before, after)
  values (
    auth.uid(),
    (select name from public.profiles where id = auth.uid()),
    tg_table_name, v_id, lower(tg_op),
    nullif(current_setting('app.audit_summary', true), ''),
    v_before, v_after
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['employees', 'employee_private', 'employee_skills', 'unavailability', 'settings',
    'activity_requirements', 'skills', 'sectors', 'schedules', 'work_days', 'assignments', 'profiles']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- Integridade das datas de trabalho -------------------------------------------
create or replace function public.check_work_day()
returns trigger language plpgsql set search_path = public as $$
declare s public.schedules;
begin
  select * into s from public.schedules where id = new.schedule_id;
  if extract(year from new.date) <> s.year or extract(month from new.date) <> s.month then
    raise exception 'A data % não pertence à escala %/%.', new.date, s.month, s.year;
  end if;
  if s.status = 'closed' and (tg_op = 'INSERT' or new.locked = false) then
    raise exception 'Escala encerrada: não é possível alterar os sábados.';
  end if;
  return new;
end $$;
create trigger work_days_check before insert or update on public.work_days
  for each row execute function public.check_work_day();

-- Regras obrigatórias das participações (validação no backend) ---------------
create or replace function public.check_assignment()
returns trigger language plpgsql set search_path = public as $$
declare
  w public.work_days;
  s public.schedules;
  v_max int;
  v_count int;
  v_only_attendance boolean := false;
  v_rec public.assignments := coalesce(new, old);
begin
  select * into w from public.work_days where id = v_rec.work_day_id;
  select * into s from public.schedules where id = w.schedule_id;

  if tg_op = 'UPDATE' then
    v_only_attendance := (to_jsonb(new) - 'attendance' - 'updated_at' - 'status' - 'replaced_by_id')
                       = (to_jsonb(old) - 'attendance' - 'updated_at' - 'status' - 'replaced_by_id');
  end if;

  if s.status = 'closed' then
    raise exception 'Escala encerrada: alterações não são permitidas.';
  end if;
  -- Em sábado bloqueado só se registra presença ou substituição (via replace_assignment)
  if w.locked and not v_only_attendance and coalesce(current_setting('app.allow_locked', true), '') <> 'on' then
    raise exception 'O sábado % está bloqueado. Desbloqueie para alterar.', to_char(w.date, 'DD/MM');
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.status = 'active' then
    select max_per_day into v_max from public.settings where id = 1;
    select count(*) into v_count from public.assignments
      where work_day_id = new.work_day_id and status = 'active' and id <> new.id;
    if v_count + 1 > v_max then
      raise exception 'Limite de transporte atingido (% pessoas por sábado).', v_max;
    end if;
  end if;

  if new.employee_id is not null and not v_only_attendance then
    if new.activity_id is not null and not exists (
      select 1 from public.employee_skills where employee_id = new.employee_id and skill_id = new.activity_id) then
      raise exception 'O colaborador não está habilitado para a atividade atribuída.';
    end if;
    if new.required_skill_id is not null and not exists (
      select 1 from public.employee_skills where employee_id = new.employee_id and skill_id = new.required_skill_id) then
      raise exception 'A vaga exige uma habilidade que o colaborador não possui.';
    end if;
  end if;
  return new;
end $$;
create trigger assignments_check before insert or update or delete on public.assignments
  for each row execute function public.check_assignment();

-- Valida restrições obrigatórias de um mês; retorna lista de problemas -------
create or replace function public.schedule_problems(p_schedule uuid)
returns table (date date, problem text) language sql stable set search_path = public as $$
  select w.date, format('%s: %s com %s de %s pessoa(s) obrigatória(s)', to_char(w.date, 'DD/MM'), k.name, coalesce(c.n, 0), r.min_count)
  from public.work_days w
  cross join public.activity_requirements r
  join public.skills k on k.id = r.skill_id
  left join lateral (
    select count(*) n from public.assignments a
    where a.work_day_id = w.id and a.status = 'active' and a.employee_id is not null and a.activity_id = r.skill_id
  ) c on true
  where w.schedule_id = p_schedule and r.mandatory and r.min_count > 0 and coalesce(c.n, 0) < r.min_count
  union all
  select w.date, format('%s: %s pessoas acima do limite de transporte', to_char(w.date, 'DD/MM'), count(*))
  from public.work_days w join public.assignments a on a.work_day_id = w.id and a.status = 'active'
  where w.schedule_id = p_schedule
  group by w.date
  having count(*) > (select max_per_day from public.settings where id = 1)
  order by 1
$$;

-- Publicar exige escala operacionalmente válida; encerrar bloqueia os sábados
create or replace function public.check_schedule_status()
returns trigger language plpgsql set search_path = public as $$
declare v_list text;
begin
  if new.status = 'published' and old.status <> 'published' then
    select string_agg(problem, '; ') into v_list from public.schedule_problems(new.id);
    if v_list is not null then
      raise exception 'A escala não pode ser publicada: %', v_list;
    end if;
    new.published_at := now();
  end if;
  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_at := now();
  end if;
  return new;
end $$;
create trigger schedules_status before update of status on public.schedules
  for each row execute function public.check_schedule_status();

create or replace function public.lock_days_on_close()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'closed' and old.status <> 'closed' then
    update public.work_days set locked = true where schedule_id = new.id;
  end if;
  return new;
end $$;
-- executa antes do encerramento efetivo para não ser barrado por check_work_day
create trigger schedules_lock_days before update of status on public.schedules
  for each row when (new.status = 'closed') execute function public.lock_days_on_close();

-- =====================================================================
-- Operações transacionais (chamadas pelo app via supabase.rpc)
-- Executam com as permissões do usuário (RLS se aplica).
-- =====================================================================
create or replace function public.require_editor()
returns void language plpgsql stable as $$
begin
  if not public.is_editor() then
    raise exception 'Permissão insuficiente para alterar escalas.';
  end if;
end $$;

create or replace function public.ensure_work_day(p_date date)
returns public.work_days language plpgsql set search_path = public as $$
declare
  v_schedule uuid;
  v_day public.work_days;
  st public.settings;
begin
  perform public.require_editor();
  if extract(isodow from p_date) <> 6 then
    raise exception 'A data % não é um sábado.', p_date;
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

-- Salva a prévia confirmada. p_days: [{date, startTime, endTime, members:[{employeeId, activityId, reservedLabel, requiredSkillId}]}]
create or replace function public.commit_month(p_year int, p_month int, p_days jsonb)
returns void language plpgsql set search_path = public as $$
declare
  d jsonb;
  m jsonb;
  w public.work_days;
  i int;
begin
  perform public.require_editor();
  perform set_config('app.audit_summary', format('Geração automática %s/%s', p_month, p_year), true);
  for d in select * from jsonb_array_elements(p_days) loop
    w := public.ensure_work_day((d ->> 'date')::date);
    if extract(year from w.date) <> p_year or extract(month from w.date) <> p_month then
      raise exception 'Data % fora do mês informado.', w.date;
    end if;
    if w.locked then
      raise exception 'O sábado % está bloqueado e não pode ser regerado.', to_char(w.date, 'DD/MM');
    end if;
    update public.work_days
      set start_time = (d ->> 'startTime')::time, end_time = (d ->> 'endTime')::time
      where id = w.id;
    delete from public.assignments where work_day_id = w.id and status = 'active';
    i := 0;
    for m in select * from jsonb_array_elements(d -> 'members') loop
      insert into public.assignments (work_day_id, employee_id, activity_id, reserved_label, required_skill_id, position)
      values (w.id, nullif(m ->> 'employeeId', '')::uuid, nullif(m ->> 'activityId', '')::uuid,
              nullif(m ->> 'reservedLabel', ''), nullif(m ->> 'requiredSkillId', '')::uuid, i);
      i := i + 1;
    end loop;
  end loop;
  update public.schedules set updated_at = now() where year = p_year and month = p_month;
end $$;

create or replace function public.add_assignment(
  p_date date, p_employee uuid, p_activity uuid, p_reserved_label text, p_required_skill uuid)
returns uuid language plpgsql set search_path = public as $$
declare
  w public.work_days;
  v_id uuid;
begin
  w := public.ensure_work_day(p_date);
  insert into public.assignments (work_day_id, employee_id, activity_id, reserved_label, required_skill_id, position)
  values (w.id, p_employee, p_activity, nullif(p_reserved_label, ''), p_required_skill,
          (select count(*) from public.assignments where work_day_id = w.id and status = 'active'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.swap_assignments(p_a uuid, p_b uuid)
returns void language plpgsql set search_path = public as $$
declare
  a public.assignments;
  b public.assignments;
  act_a uuid;
  act_b uuid;
begin
  perform public.require_editor();
  select * into a from public.assignments where id = p_a and status = 'active' for update;
  select * into b from public.assignments where id = p_b and status = 'active' for update;
  if a.id is null or b.id is null then raise exception 'Participação não encontrada.'; end if;
  if a.work_day_id = b.work_day_id then raise exception 'As duas pessoas já estão no mesmo sábado.'; end if;
  if b.employee_id is not null and exists (select 1 from public.assignments where work_day_id = a.work_day_id and employee_id = b.employee_id and status = 'active') then
    raise exception 'O colaborador já está escalado no sábado de destino.';
  end if;
  if a.employee_id is not null and exists (select 1 from public.assignments where work_day_id = b.work_day_id and employee_id = a.employee_id and status = 'active') then
    raise exception 'O colaborador já está escalado no sábado de destino.';
  end if;
  -- cada pessoa assume a atividade da outra quando habilitada; senão mantém a própria
  act_a := case when a.activity_id is not null and exists (select 1 from public.employee_skills where employee_id = b.employee_id and skill_id = a.activity_id) then a.activity_id else b.activity_id end;
  act_b := case when b.activity_id is not null and exists (select 1 from public.employee_skills where employee_id = a.employee_id and skill_id = b.activity_id) then b.activity_id else a.activity_id end;
  perform set_config('app.audit_summary', 'Troca entre sábados', true);
  update public.assignments set employee_id = a.employee_id, reserved_label = a.reserved_label, required_skill_id = a.required_skill_id, activity_id = act_b, attendance = null where id = b.id;
  update public.assignments set employee_id = b.employee_id, reserved_label = b.reserved_label, required_skill_id = b.required_skill_id, activity_id = act_a, attendance = null where id = a.id;
end $$;

create or replace function public.move_assignment(p_id uuid, p_date date)
returns void language plpgsql set search_path = public as $$
declare
  w public.work_days;
begin
  w := public.ensure_work_day(p_date);
  perform set_config('app.audit_summary', 'Movido para outro sábado', true);
  update public.assignments
    set work_day_id = w.id, attendance = null,
        position = (select count(*) from public.assignments where work_day_id = w.id and status = 'active')
    where id = p_id and status = 'active';
  if not found then raise exception 'Participação não encontrada.'; end if;
end $$;

-- Substituição: a participação original fica como "substituída" (histórico preservado)
create or replace function public.replace_assignment(p_id uuid, p_employee uuid, p_activity uuid)
returns uuid language plpgsql set search_path = public as $$
declare
  a public.assignments;
  v_new uuid;
begin
  perform public.require_editor();
  select * into a from public.assignments where id = p_id and status = 'active' for update;
  if a.id is null then raise exception 'Participação não encontrada.'; end if;
  perform set_config('app.allow_locked', 'on', true);
  perform set_config('app.audit_summary', case when a.employee_id is null then 'Vaga reservada preenchida' else 'Substituição' end, true);
  if a.employee_id is null then
    delete from public.assignments where id = a.id;
  else
    update public.assignments set status = 'replaced' where id = a.id;
  end if;
  insert into public.assignments (work_day_id, employee_id, activity_id, reserved_label, required_skill_id, position)
  values (a.work_day_id, p_employee, p_activity, a.reserved_label, a.required_skill_id, a.position)
  returning id into v_new;
  if a.employee_id is not null then
    update public.assignments set replaced_by_id = v_new where id = a.id;
  end if;
  perform set_config('app.allow_locked', '', true);
  return v_new;
end $$;

-- Salvar colaborador + habilidades + dados internos de forma atômica
create or replace function public.save_employee(p jsonb)
returns uuid language plpgsql set search_path = public as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if not public.is_admin() then raise exception 'Apenas administradores gerenciam colaboradores.'; end if;
  if v_id is null or not exists (select 1 from public.employees where id = v_id) then
    insert into public.employees (id, full_name, short_name, registration, sector_id, admission_date, status, max_per_month)
    values (coalesce(v_id, gen_random_uuid()), p ->> 'fullName', p ->> 'shortName', nullif(p ->> 'registration', ''),
            nullif(p ->> 'sectorId', '')::uuid, nullif(p ->> 'admissionDate', '')::date,
            coalesce(p ->> 'status', 'active')::public.employee_status, nullif(p ->> 'maxPerMonth', '')::int)
    returning id into v_id;
  else
    update public.employees set
      full_name = p ->> 'fullName', short_name = p ->> 'shortName', registration = nullif(p ->> 'registration', ''),
      sector_id = nullif(p ->> 'sectorId', '')::uuid, admission_date = nullif(p ->> 'admissionDate', '')::date,
      status = (p ->> 'status')::public.employee_status, max_per_month = nullif(p ->> 'maxPerMonth', '')::int
    where id = v_id;
  end if;
  insert into public.employee_private (employee_id, restrictions, admin_notes)
  values (v_id, nullif(p ->> 'restrictions', ''), nullif(p ->> 'adminNotes', ''))
  on conflict (employee_id) do update set restrictions = excluded.restrictions, admin_notes = excluded.admin_notes;
  delete from public.employee_skills where employee_id = v_id
    and skill_id not in (select (jsonb_array_elements_text(p -> 'skillIds'))::uuid);
  insert into public.employee_skills (employee_id, skill_id)
  select v_id, (x)::uuid from jsonb_array_elements_text(p -> 'skillIds') x
  on conflict do nothing;
  return v_id;
end $$;

-- Salvar configurações + requisitos de atividade de forma atômica
create or replace function public.save_settings(p_settings jsonb, p_requirements jsonb)
returns void language plpgsql set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Apenas administradores alteram configurações.'; end if;
  update public.settings set
    org_name = p_settings ->> 'orgName',
    ideal_per_day = (p_settings ->> 'idealPerDay')::int,
    max_per_day = (p_settings ->> 'maxPerDay')::int,
    start_time = (p_settings ->> 'startTime')::time,
    end_time = (p_settings ->> 'endTime')::time,
    max_per_month = (p_settings ->> 'maxPerMonth')::int,
    avoid_consecutive = (p_settings ->> 'avoidConsecutive')::boolean,
    min_gap_weeks = (p_settings ->> 'minGapWeeks')::int,
    balance_priority = p_settings ->> 'balancePriority',
    consider_history_months = (p_settings ->> 'considerHistoryMonths')::int,
    print = p_settings -> 'print'
  where id = 1;
  delete from public.activity_requirements;
  insert into public.activity_requirements (skill_id, min_count, mandatory)
  select (r ->> 'skillId')::uuid, (r ->> 'minCount')::int, (r ->> 'mandatory')::boolean
  from jsonb_array_elements(p_requirements) r;
end $$;
