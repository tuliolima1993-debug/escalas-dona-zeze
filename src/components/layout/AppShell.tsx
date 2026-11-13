import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { CalendarRange, ChartColumnBig, FlaskConical, History, LayoutDashboard, Leaf, LogOut, Menu as MenuIcon, Printer, RotateCcw, Settings, ShieldCheck, Users, X } from 'lucide-react';
import { useData } from '@/data/DataProvider';
import { resetDemoData, setDemoRole } from '@/data/demoRepository';
import { ROLE_LABEL, type Role } from '@/domain/types';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, end: true },
  { to: '/escalas', label: 'Escalas', icon: CalendarRange },
  { to: '/colaboradores', label: 'Colaboradores', icon: Users },
  { to: '/frequencia', label: 'Frequência', icon: ChartColumnBig },
  { to: '/impressao', label: 'Impressão', icon: Printer },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, edit: true },
  { to: '/historico', label: 'Histórico', icon: History, edit: true },
  { to: '/usuarios', label: 'Usuários', icon: ShieldCheck, admin: true },
];

export function AppShell() {
  const { profile, repo, can, reload } = useData();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => (!n.admin || can.admin) && (!n.edit || can.edit));
  const demo = repo.mode === 'demo';

  const nav = (
    <nav className="flex flex-col gap-1">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
          className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors', isActive ? 'bg-white/10 text-white shadow-inner' : 'text-emerald-100/70 hover:bg-white/5 hover:text-white')}>
          {({ isActive }) => (<><Icon className={cn('h-[18px] w-[18px]', isActive && 'text-emerald-300')} />{label}</>)}
        </NavLink>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-3 px-2">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-900/40"><Leaf className="h-5 w-5" /></span>
      <div className="leading-tight"><p className="text-[15px] font-extrabold text-white">Dona Zezé Conde</p><p className="text-xs font-medium text-emerald-200/70">Gestão de Escalas</p></div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col gap-8 bg-forest-950 bg-leaf px-4 py-6 lg:flex">
        {brand}
        {nav}
        <div className="mt-auto rounded-xl bg-white/5 p-3 text-xs text-emerald-100/70">
          {demo ? <p className="flex items-center gap-2 font-semibold text-amber-300"><FlaskConical className="h-4 w-4" />Modo demonstração</p> : <p>Conectado ao Supabase</p>}
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col gap-8 bg-forest-950 bg-leaf px-4 py-6 animate-in slide-in-from-left">
            <div className="flex items-center justify-between">{brand}<button className="text-white" onClick={() => setOpen(false)} aria-label="Fechar menu"><X /></button></div>
            {nav}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
        <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu"><MenuIcon /></button>
        {demo && <span className="hidden items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 sm:inline-flex"><FlaskConical className="h-3.5 w-3.5" />Demonstração — dados salvos apenas neste navegador</span>}
        <div className="ml-auto">
          <Menu>
            <MenuTrigger asChild>
              <button className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-muted">
                <div className="text-right leading-tight"><p className="text-sm font-bold">{profile?.name}</p><p className="text-xs text-muted-foreground">{profile && ROLE_LABEL[profile.role]}</p></div>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-forest-700 text-sm font-extrabold text-white">{profile?.name?.[0]?.toUpperCase()}</span>
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{profile?.email}</MenuLabel>
              {demo && (
                <>
                  <MenuSeparator />
                  <MenuLabel>Testar perfil de acesso</MenuLabel>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <MenuItem key={r} onSelect={() => { setDemoRole(r); reload(); }}>{profile?.role === r ? '● ' : ''}{ROLE_LABEL[r]}</MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem onSelect={() => { resetDemoData(); reload(); }}><RotateCcw />Restaurar dados de exemplo</MenuItem>
                </>
              )}
              {!demo && <><MenuSeparator /><MenuItem onSelect={() => repo.signOut()}><LogOut />Sair</MenuItem></>}
            </MenuContent>
          </Menu>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-8"><Outlet /></main>
    </div>
  );
}
