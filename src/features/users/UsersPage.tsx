import { useEffect, useState } from 'react';
import { MailPlus, ShieldCheck } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { ROLE_LABEL, type Profile, type Role } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { initials } from '../employees/EmployeesPage';

const ROLE_DESC: Record<Role, string> = {
  admin: 'Gerencia colaboradores, configurações, escalas e usuários.',
  supervisor: 'Cria, edita, confirma escalas e registra presença.',
  viewer: 'Consulta escalas publicadas e imprime.',
};

export function UsersPage() {
  const { repo, run, profile, s } = useSnapshot();
  const [users, setUsers] = useState<Profile[]>([]);
  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('supervisor');
  useEffect(() => { repo.listProfiles().then(setUsers).catch(() => setUsers([])); }, [repo, s]);

  return (
    <div>
      <PageHeader title="Usuários e permissões" description="Controle de acesso ao sistema. As permissões também são garantidas no banco de dados (RLS)."
        actions={<Button onClick={() => setInvite(true)}><MailPlus />Convidar usuário</Button>} />
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
          <Card key={r} className="p-4"><p className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-emerald-700" />{ROLE_LABEL[r]}</p><p className="mt-1 text-sm text-muted-foreground">{ROLE_DESC[r]}</p></Card>
        ))}
      </div>
      <Card className="divide-y divide-slate-100">
        {users.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-forest-100 text-xs font-extrabold text-forest-800">{initials(u.name || u.email)}</span>
            <div className="min-w-0 flex-1"><p className="font-semibold">{u.name} {u.id === profile?.id && <span className="text-xs text-muted-foreground">(você)</span>}</p><p className="text-xs text-muted-foreground">{u.email}</p></div>
            <Select className="w-44" value={u.role} onChange={(e) => run((r) => r.updateRole(u.id, e.target.value as Role), 'Perfil atualizado.')} aria-label="Perfil">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </div>
        ))}
      </Card>
      {repo.mode === 'demo' && <p className="mt-3 text-xs text-muted-foreground">Modo demonstração: altere o seu próprio perfil para experimentar as permissões de supervisor e visualizador.</p>}

      <Dialog open={invite} onOpenChange={setInvite}>
        <DialogContent>
          <DialogHeader><DialogTitle>Convidar usuário</DialogTitle><DialogDescription>A pessoa recebe um e-mail para definir a senha.</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Perfil" hint={ROLE_DESC[role]}>
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvite(false)}>Cancelar</Button>
            <Button disabled={!/^\S+@\S+\.\S+$/.test(email)} onClick={async () => { if (await run((r) => r.inviteUser(email.trim(), name.trim(), role), 'Convite enviado.')) { setInvite(false); setEmail(''); setName(''); } }}>Enviar convite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
