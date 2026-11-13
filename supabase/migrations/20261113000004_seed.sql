-- Dados iniciais
insert into public.settings (id) values (1) on conflict do nothing;

insert into public.skills (name, color, sort_order) values
  ('Clonagem', '#7c3aed', 1),
  ('Cultivo', '#16a34a', 2),
  ('Pós-Colheita', '#d97706', 3)
on conflict (name) do nothing;

insert into public.sectors (name, color, default_skill_id, sort_order) values
  ('Cultivo', '#16a34a', (select id from public.skills where name = 'Cultivo'), 1),
  ('Pós-Colheita', '#d97706', (select id from public.skills where name = 'Pós-Colheita'), 2),
  ('G&P', '#0e7490', null, 3)
on conflict (name) do nothing;

insert into public.activity_requirements (skill_id, min_count, mandatory)
select id, 1, true from public.skills where name = 'Clonagem'
on conflict do nothing;

with data(full_name, short_name, sector) as (values
  ('Ailton Ferreira do Nascimento Junior', 'Ailton Ferreira', 'Cultivo'),
  ('David Victor da Silva Andrade', 'David Victor', 'Cultivo'),
  ('Emerson Lucas Ribeiro da Silva', 'Emerson Lucas', 'Cultivo'),
  ('Josenaldo das Neves', 'Josenaldo Neves', 'Cultivo'),
  ('Edna Gomes Euzebio', 'Edna Gomes', 'Pós-Colheita'),
  ('Tatiana Almeida da Silva', 'Tatiana Almeida', 'Pós-Colheita'),
  ('Ediane Macedo Paz de Lima', 'Ediane Macedo', 'G&P'),
  ('José Ivan Batista Filho', 'José Ivan', 'G&P'),
  ('Marcelo Pontes Soares', 'Marcelo Pontes', 'G&P'))
insert into public.employees (full_name, short_name, sector_id)
select d.full_name, d.short_name, s.id from data d join public.sectors s on s.name = d.sector
where not exists (select 1 from public.employees e where e.full_name = d.full_name);

-- Habilidade do próprio setor
insert into public.employee_skills (employee_id, skill_id)
select e.id, s.default_skill_id from public.employees e join public.sectors s on s.id = e.sector_id
where s.default_skill_id is not null
on conflict do nothing;

-- Habilitados para clonagem
insert into public.employee_skills (employee_id, skill_id)
select e.id, k.id from public.employees e, public.skills k
where k.name = 'Clonagem' and e.short_name in ('Ediane Macedo', 'José Ivan', 'Marcelo Pontes', 'Edna Gomes')
on conflict do nothing;

-- O seed não deve aparecer como alterações de usuários
delete from public.audit_log;
