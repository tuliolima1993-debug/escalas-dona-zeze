import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useData } from '@/data/DataProvider';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

/** Tela exibida ao abrir o link de "Esqueci minha senha": define a senha nova. */
export function SetPasswordPage({ onDone }: { onDone: () => void }) {
  const { repo } = useData();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = pw.length > 0 && pw.length < 8 ? 'Use pelo menos 8 caracteres.' : pw2 && pw !== pw2 ? 'As senhas não conferem.' : null;
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form className="w-full max-w-sm space-y-5" onSubmit={async (e) => {
        e.preventDefault();
        if (problem || !pw) return;
        setBusy(true); setError(null);
        try { await repo.updatePassword(pw); onDone(); } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar a senha.'); }
        finally { setBusy(false); }
      }}>
        <div>
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-emerald-700"><KeyRound className="h-4 w-4" />Dona Zezé Conde</p>
          <h1 className="text-2xl font-extrabold tracking-tight">Criar nova senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">Escolha a senha que você vai usar para entrar no sistema.</p>
        </div>
        <Field label="Nova senha"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Repita a nova senha" error={problem ?? error ?? undefined}><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy || !!problem || !pw || pw !== pw2}>{busy ? 'Salvando…' : 'Salvar nova senha'}</Button>
      </form>
    </div>
  );
}
