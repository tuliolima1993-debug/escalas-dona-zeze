export const env = {
  mode: (import.meta.env.VITE_DATA_MODE as string | undefined) ?? (import.meta.env.VITE_SUPABASE_URL ? 'supabase' : 'demo'),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
};
