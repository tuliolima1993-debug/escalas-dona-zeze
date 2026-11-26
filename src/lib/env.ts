export const env = {
  mode: (import.meta.env.VITE_DATA_MODE as string | undefined) ?? (import.meta.env.VITE_SUPABASE_URL ? 'supabase' : 'demo'),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  /** Sem tela de login: todos entram como "Equipe" (administrador). */
  openAccess: import.meta.env.VITE_OPEN_ACCESS === 'true',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
};
