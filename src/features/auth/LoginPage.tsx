import { useState } from 'react';
import { Leaf, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { useData } from '@/data/DataProvider';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

export function LoginPage() {
  const { repo, reload } = useData();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await repo.signIn(email.trim(), password);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-forest-950 bg-leaf p-12 text-white lg:flex">
        <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300"><Leaf /></span><span className="text-lg font-extrabold">Dona Zezé Conde</span></div>
        <div>
          <p className="text-4xl font-extrabold leading-tight tracking-tight">Escalas de sábado justas,<br />claras e prontas para o quadro.</p>
          <p className="mt-4 max-w-md text-emerald-100/80">Geração automática equilibrada, cobertura obrigatória da clonagem, presença e histórico em um só lugar.</p>
        </div>
        <p className="text-sm text-emerald-200/60">Gestão de Escalas</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-emerald-700">Dona Zezé Conde</p>
            <h1 className="text-2xl font-extrabold tracking-tight">Entrar no sistema</h1>
            <p className="mt-1 text-sm text-muted-foreground">Acesso restrito à equipe administrativa.</p>
          </div>
          <Field label="E-mail"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Senha" error={error ?? undefined}><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}><LogIn />{busy ? 'Entrando…' : 'Entrar'}</Button>
          <button type="button" disabled={sending} className="w-full text-center text-sm font-semibold text-emerald-700 hover:underline disabled:opacity-60"
            onClick={async () => {
              setError(null); setInfo(null);
              if (!email.trim()) { setError('Digite o seu e-mail no campo acima e clique de novo em “Esqueci minha senha”.'); return; }
              setSending(true);
              try {
                await repo.resetPassword(email.trim());
                setInfo(`Se ${email.trim()} estiver cadastrado, enviamos um link para criar uma nova senha. Veja a caixa de entrada e o spam. O link abre esta página para você definir a senha nova.`);
                toast.success('E-mail de redefinição enviado.');
              } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível enviar o e-mail.'); }
              finally { setSending(false); }
            }}>{sending ? 'Enviando…' : 'Esqueci minha senha'}</button>
          {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{info}</p>}
        </form>
      </div>
    </div>
  );
}
