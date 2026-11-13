import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Profile, Snapshot } from '@/domain/types';
import { env } from '@/lib/env';
import { createDemoRepository } from './demoRepository';
import type { Repository } from './repository';
import { createSupabaseRepository } from './supabaseRepository';

interface DataCtx {
  repo: Repository;
  snapshot: Snapshot | null;
  profile: Profile | null;
  authChecked: boolean;
  loading: boolean;
  loadError: string | null;
  reload: () => Promise<void>;
  /** Executa uma alteração, mostra o resultado e recarrega os dados. Retorna true em caso de sucesso. */
  run: (fn: (r: Repository) => Promise<unknown>, success?: string) => Promise<boolean>;
  can: { edit: boolean; admin: boolean };
  year: number;
  month: number;
  setPeriod: (y: number, m: number) => void;
}

const Ctx = createContext<DataCtx | null>(null);

function makeRepo(): Repository {
  if (env.mode === 'supabase' && env.supabaseUrl && env.supabaseAnonKey) return createSupabaseRepository(env.supabaseUrl, env.supabaseAnonKey);
  return createDemoRepository();
}

const PERIOD_KEY = 'dzc-period';
function initialPeriod(): [number, number] {
  try {
    const raw = sessionStorage.getItem(PERIOD_KEY);
    if (raw) { const [y, m] = raw.split('-').map(Number); if (y && m) return [y, m]; }
  } catch { /* noop */ }
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1];
}

export function DataProvider({ children }: { children: ReactNode }) {
  const repo = useMemo(makeRepo, []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [[year, month], setYM] = useState<[number, number]>(initialPeriod);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const p = await repo.currentProfile();
      setProfile(p);
      setAuthChecked(true);
      if (!p) { setSnapshot(null); return; }
      setSnapshot(await repo.load());
      setLoadError(null);
    } catch (e) {
      setAuthChecked(true);
      setLoadError(e instanceof Error ? e.message : 'Falha ao carregar os dados.');
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    reload();
    return repo.onAuthChange(() => reload());
  }, [repo, reload]);

  const run = useCallback<DataCtx['run']>(async (fn, success) => {
    try {
      await fn(repo);
      if (success) toast.success(success);
      await reload();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir a operação.');
      await reload();
      return false;
    }
  }, [repo, reload]);

  const setPeriod = useCallback((y: number, m: number) => {
    setYM([y, m]);
    try { sessionStorage.setItem(PERIOD_KEY, `${y}-${m}`); } catch { /* noop */ }
  }, []);

  const role = profile?.role ?? 'viewer';
  const value: DataCtx = {
    repo, snapshot, profile, authChecked, loading, loadError, reload, run,
    can: { edit: role === 'admin' || role === 'supervisor', admin: role === 'admin' },
    year, month, setPeriod,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useData fora do DataProvider');
  return c;
}

/** Atalho para quando o snapshot já está garantido (dentro do AppShell). */
export function useSnapshot() {
  const c = useData();
  return { ...c, s: c.snapshot! };
}
