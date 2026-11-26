-- =====================================================================
-- Acesso aberto (sem senha): o app entra com uma sessão anônima do Supabase.
-- Usuários anônimos recebem o perfil "admin" com o nome "Equipe".
-- Requer, no painel: Authentication → Sign In / Providers → "Allow anonymous sign-ins" LIGADO.
-- Para voltar a exigir login, basta desligar essa opção e remover VITE_OPEN_ACCESS do .env.production.
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role := 'viewer';
  v_anon boolean := coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false);
begin
  if v_anon then
    v_role := 'admin';
  elsif not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  end if;
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    case when v_anon then 'Equipe' else coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)) end,
    coalesce(new.email, ''),
    v_role)
  on conflict (id) do nothing;
  return new;
end $$;
