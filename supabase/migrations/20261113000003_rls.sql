-- =====================================================================
-- Row Level Security
--   admin       : tudo
--   supervisor  : cria, edita e confirma escalas; registra presença e indisponibilidades
--   viewer      : consulta escalas publicadas/encerradas e imprime
-- Dados internos (restrições, observações, motivos de afastamento) só para admin/supervisor.
-- =====================================================================
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;

alter table public.profiles enable row level security;
alter table public.skills enable row level security;
alter table public.sectors enable row level security;
alter table public.employees enable row level security;
alter table public.employee_private enable row level security;
alter table public.employee_skills enable row level security;
alter table public.unavailability enable row level security;
alter table public.settings enable row level security;
alter table public.activity_requirements enable row level security;
alter table public.schedules enable row level security;
alter table public.work_days enable row level security;
alter table public.assignments enable row level security;
alter table public.audit_log enable row level security;

-- Perfis
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin() or id = auth.uid()) with check (public.is_admin() or id = auth.uid());

-- Catálogos e configurações: todos leem; admin altera
do $$
declare t text;
begin
  foreach t in array array['skills', 'sectors', 'settings', 'activity_requirements', 'employees', 'employee_skills'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_delete', t);
  end loop;
end $$;

-- Dados internos
create policy employee_private_select on public.employee_private for select to authenticated using (public.is_editor());
create policy employee_private_write on public.employee_private for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Disponibilidade: admin e supervisor
create policy unavailability_select on public.unavailability for select to authenticated using (public.is_editor());
create policy unavailability_write on public.unavailability for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

-- Escalas: editores veem tudo; visualizador só publicadas/encerradas
create policy schedules_select on public.schedules for select to authenticated
  using (public.is_editor() or status in ('published', 'closed'));
create policy schedules_write on public.schedules for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

create policy work_days_select on public.work_days for select to authenticated
  using (public.is_editor() or exists (
    select 1 from public.schedules s where s.id = schedule_id and s.status in ('published', 'closed')));
create policy work_days_write on public.work_days for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

create policy assignments_select on public.assignments for select to authenticated
  using (public.is_editor() or exists (
    select 1 from public.work_days w join public.schedules s on s.id = w.schedule_id
    where w.id = work_day_id and s.status in ('published', 'closed')));
create policy assignments_write on public.assignments for all to authenticated
  using (public.is_editor()) with check (public.is_editor());

-- Histórico: leitura para editores; escrita apenas pelos gatilhos
create policy audit_select on public.audit_log for select to authenticated using (public.is_editor());

-- Funções
revoke execute on all functions in schema public from anon;
grant execute on all functions in schema public to authenticated;
