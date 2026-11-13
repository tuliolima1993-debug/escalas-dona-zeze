-- =====================================================================
-- Dona Zezé Conde | Gestão de Escalas — estrutura relacional
-- =====================================================================

create type public.app_role as enum ('admin', 'supervisor', 'viewer');
create type public.employee_status as enum ('active', 'inactive', 'vacation', 'leave');
create type public.schedule_status as enum ('draft', 'published', 'closed');
create type public.assignment_status as enum ('active', 'replaced');
create type public.attendance_status as enum ('present', 'absent');

-- Usuários e permissões ------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role public.app_role not null default 'viewer',
  created_at timestamptz not null default now()
);

-- Habilidades / atividades ----------------------------------------------
create table public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 60),
  color text not null default '#16a34a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active boolean not null default true,
  sort_order int not null default 0
);

-- Setores (repartições internas) ----------------------------------------
create table public.sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 60),
  color text not null default '#0e7490' check (color ~ '^#[0-9a-fA-F]{6}$'),
  default_skill_id uuid references public.skills (id) on delete set null,
  active boolean not null default true,
  sort_order int not null default 0
);

-- Colaboradores ----------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 3 and 120),
  short_name text not null check (length(trim(short_name)) between 2 and 40),
  registration text unique,
  sector_id uuid references public.sectors (id) on delete set null,
  admission_date date,
  status public.employee_status not null default 'active',
  max_per_month int check (max_per_month is null or max_per_month between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employees_status_idx on public.employees (status);
create index employees_sector_idx on public.employees (sector_id);

-- Dados internos (nunca expostos ao perfil visualizador)
create table public.employee_private (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  restrictions text,
  admin_notes text
);

create table public.employee_skills (
  employee_id uuid not null references public.employees (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  primary key (employee_id, skill_id)
);
create index employee_skills_skill_idx on public.employee_skills (skill_id);

-- Disponibilidade e afastamentos ----------------------------------------
create table public.unavailability (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index unavailability_emp_idx on public.unavailability (employee_id, start_date, end_date);

-- Configurações operacionais (linha única) -------------------------------
create table public.settings (
  id int primary key default 1 check (id = 1),
  org_name text not null default 'CULTIVO DONA ZEZÉ CONDE',
  ideal_per_day int not null default 4 check (ideal_per_day between 1 and 30),
  max_per_day int not null default 4 check (max_per_day between 1 and 30),
  start_time time not null default '06:00',
  end_time time not null default '09:00',
  max_per_month int not null default 2 check (max_per_month between 1 and 5),
  avoid_consecutive boolean not null default true,
  min_gap_weeks int not null default 2 check (min_gap_weeks between 1 and 5),
  balance_priority text not null default 'high' check (balance_priority in ('high', 'medium', 'low')),
  consider_history_months int not null default 0 check (consider_history_months between 0 and 36),
  print jsonb not null default '{"paper":"A4","showActivityCounts":true,"emptySlotsToIdeal":true,"footerText":""}',
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  check (ideal_per_day <= max_per_day)
);

-- Atividades obrigatórias / preferenciais por sábado
create table public.activity_requirements (
  skill_id uuid primary key references public.skills (id) on delete cascade,
  min_count int not null default 1 check (min_count between 0 and 30),
  mandatory boolean not null default true
);

-- Meses e escalas --------------------------------------------------------
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  year int not null check (year between 2020 and 2100),
  month int not null check (month between 1 and 12),
  status public.schedule_status not null default 'draft',
  published_at timestamptz,
  closed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, month)
);

-- Datas de trabalho ------------------------------------------------------
create table public.work_days (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules (id) on delete cascade,
  date date not null unique check (extract(isodow from date) = 6),
  start_time time not null,
  end_time time not null,
  locked boolean not null default false,
  note text check (note is null or length(note) <= 200),
  check (end_time > start_time)
);
create index work_days_schedule_idx on public.work_days (schedule_id, date);

-- Participações / atividades atribuídas / vagas reservadas / presença ----
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  work_day_id uuid not null references public.work_days (id) on delete cascade,
  employee_id uuid references public.employees (id) on delete restrict,
  activity_id uuid references public.skills (id) on delete set null,
  reserved_label text check (reserved_label is null or length(reserved_label) <= 60),
  required_skill_id uuid references public.skills (id) on delete set null,
  status public.assignment_status not null default 'active',
  attendance public.attendance_status,
  replaced_by_id uuid references public.assignments (id) on delete set null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- uma participação é de um colaborador ou é uma vaga reservada
  check (employee_id is not null or reserved_label is not null),
  check (status = 'active' or employee_id is not null)
);
-- Evita duplicidade da mesma pessoa no mesmo sábado
create unique index assignments_unique_person_day
  on public.assignments (work_day_id, employee_id)
  where status = 'active' and employee_id is not null;
create index assignments_employee_idx on public.assignments (employee_id);
create index assignments_day_idx on public.assignments (work_day_id) where status = 'active';

-- Histórico de alterações ------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_name text,
  entity text not null,
  entity_id uuid,
  action text not null,
  summary text,
  before jsonb,
  after jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

-- Relatório de participação calculado a partir dos registros reais --------
create view public.v_participations with (security_invoker = true) as
select
  a.id as assignment_id,
  a.employee_id,
  e.short_name,
  w.date,
  extract(year from w.date)::int as year,
  extract(month from w.date)::int as month,
  a.activity_id,
  a.status,
  a.attendance,
  extract(epoch from (w.end_time - w.start_time)) / 3600.0 as hours
from public.assignments a
join public.work_days w on w.id = a.work_day_id
join public.employees e on e.id = a.employee_id;

create view public.v_employee_month_stats with (security_invoker = true) as
select
  employee_id,
  short_name,
  year,
  month,
  count(*) filter (where status = 'active') as scheduled,
  count(*) filter (where status = 'active' and attendance = 'present') as present,
  count(*) filter (where status = 'active' and attendance = 'absent') as absent,
  count(*) filter (where status = 'replaced') as replaced,
  coalesce(sum(hours) filter (where status = 'active' and attendance = 'present'), 0) as hours_worked
from public.v_participations
group by employee_id, short_name, year, month;
