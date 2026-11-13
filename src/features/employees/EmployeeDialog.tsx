import { useMemo, useState } from 'react';
import { z } from 'zod';
import { CalendarPlus, Lock, Trash2, UserX } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { fmtFull, saturdaysOfMonth } from '@/domain/dates';
import { uid } from '@/domain/mutations';
import { STATUS_LABEL, type Employee } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dot, TabsContent, TabsList, TabsRoot, TabsTrigger } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { todayISO, useLookups } from '../schedule/lookups';

const schema = z.object({
  fullName: z.string().trim().min(3, 'Informe o nome completo (mín. 3 letras).').max(120),
  shortName: z.string().trim().min(2, 'Informe o nome para a escala.').max(24, 'Use até 24 caracteres para caber bem na impressão.'),
  registration: z.string().trim().max(30).nullable(),
  sectorId: z.string().nullable(),
  admissionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal('')),
  status: z.enum(['active', 'inactive', 'vacation', 'leave']),
  maxPerMonth: z.number().int().min(1).max(5).nullable(),
});

const blank = (): Employee => ({
  id: '', fullName: '', shortName: '', registration: null, sectorId: null, skillIds: [], admissionDate: null,
  status: 'active', restrictions: null, maxPerMonth: null, adminNotes: null,
});

export function EmployeeDialog({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const { s, run, can } = useSnapshot();
  const L = useLookups();
  const [form, setForm] = useState<Employee>(employee ? structuredClone(employee) : blank());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Employee>(k: K, v: Employee[K]) => setForm((f) => ({ ...f, [k]: v }));
  const readOnly = !can.admin;

  const save = async () => {
    const parsed = schema.safeParse({ ...form, admissionDate: form.admissionDate ?? null });
    const errs: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] = i.message;
    if (s.employees.some((e) => e.id !== form.id && e.registration && form.registration && e.registration === form.registration.trim())) errs.registration = 'Matrícula já utilizada.';
    if (s.employees.some((e) => e.id !== form.id && e.shortName.trim().toLowerCase() === form.shortName.trim().toLowerCase())) errs.shortName = 'Já existe alguém com esse nome na escala.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const ok = await run((r) => r.saveEmployee({ ...form, id: form.id || uid(), fullName: form.fullName.trim(), shortName: form.shortName.trim(), registration: form.registration?.trim() || null }), employee ? 'Cadastro atualizado.' : 'Colaborador cadastrado.');
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{employee ? employee.shortName : 'Novo colaborador'}</DialogTitle>
          <DialogDescription>{employee ? employee.fullName : 'Preencha os dados. Habilidades podem ser diferentes do setor principal.'}</DialogDescription>
        </DialogHeader>
        <TabsRoot defaultValue={readOnly ? 'availability' : 'data'} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border px-6 pt-3 pb-3">
            <TabsList>
              <TabsTrigger value="data">Dados</TabsTrigger>
              <TabsTrigger value="skills">Habilidades</TabsTrigger>
              <TabsTrigger value="availability" disabled={!employee}>Disponibilidade</TabsTrigger>
              <TabsTrigger value="notes">Restrições e notas</TabsTrigger>
            </TabsList>
          </div>
          <DialogBody>
            <TabsContent value="data" className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome completo *" error={errors.fullName} className="sm:col-span-2">
                <Input disabled={readOnly} value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Ex.: Maria da Silva Santos" />
              </Field>
              <Field label="Nome na escala *" error={errors.shortName} hint="Nome abreviado exibido nos cartões e na impressão.">
                <Input disabled={readOnly} value={form.shortName} maxLength={24} onChange={(e) => set('shortName', e.target.value)} placeholder="Ex.: Maria Silva" />
              </Field>
              <Field label="Matrícula (opcional)" error={errors.registration}>
                <Input disabled={readOnly} value={form.registration ?? ''} onChange={(e) => set('registration', e.target.value || null)} />
              </Field>
              <Field label="Setor principal">
                <Select disabled={readOnly} value={form.sectorId ?? ''} onChange={(e) => set('sectorId', e.target.value || null)}>
                  <option value="">Sem setor</option>
                  {s.sectors.filter((x) => x.active || x.id === form.sectorId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              </Field>
              <Field label="Data de admissão" error={errors.admissionDate}>
                <Input disabled={readOnly} type="date" value={form.admissionDate ?? ''} onChange={(e) => set('admissionDate', e.target.value || null)} />
              </Field>
              <Field label="Situação">
                <Select disabled={readOnly} value={form.status} onChange={(e) => set('status', e.target.value as Employee['status'])}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Limite individual de sábados/mês" hint={`Vazio = padrão (${s.settings.maxPerMonth}).`} error={errors.maxPerMonth}>
                <Input disabled={readOnly} type="number" min={1} max={5} value={form.maxPerMonth ?? ''} onChange={(e) => set('maxPerMonth', e.target.value ? +e.target.value : null)} />
              </Field>
              {employee && form.status !== 'inactive' && can.admin && (
                <div className="sm:col-span-2">
                  <Button variant="outline" size="sm" className="text-red-600" onClick={() => set('status', 'inactive')}><UserX />Desativar colaborador (histórico preservado)</Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="skills">
              <p className="mb-3 text-sm text-muted-foreground">Marque as atividades que a pessoa pode executar. Ex.: alguém da Pós-Colheita também habilitado para Clonagem.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {s.skills.filter((k) => k.active || form.skillIds.includes(k.id)).map((k) => (
                  <label key={k.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition', form.skillIds.includes(k.id) ? 'border-emerald-400 bg-emerald-50' : 'border-border hover:bg-slate-50')}>
                    <Checkbox disabled={readOnly} checked={form.skillIds.includes(k.id)} onCheckedChange={(v) => set('skillIds', v ? [...form.skillIds, k.id] : form.skillIds.filter((x) => x !== k.id))} />
                    <Dot color={k.color} />
                    <span className="text-sm font-semibold">{k.name}</span>
                    {L.mandatorySkillIds.includes(k.id) && <span className="ml-auto text-[11px] font-semibold text-violet-700">obrigatória</span>}
                  </label>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="availability">{employee && <AvailabilityEditor employeeId={employee.id} />}</TabsContent>

            <TabsContent value="notes" className="space-y-4">
              <Field label="Restrições individuais de escala" hint="Visível apenas para administradores e supervisores.">
                <Textarea disabled={readOnly} value={form.restrictions ?? ''} onChange={(e) => set('restrictions', e.target.value || null)} placeholder="Ex.: não pode trabalhar no primeiro sábado do mês" />
              </Field>
              <Field label="Observações administrativas internas" hint="Nunca aparecem na impressão nem para o perfil visualizador.">
                <Textarea disabled={readOnly} value={form.adminNotes ?? ''} onChange={(e) => set('adminNotes', e.target.value || null)} />
              </Field>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />Dados protegidos por permissão no banco (RLS).</p>
            </TabsContent>
          </DialogBody>
        </TabsRoot>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{readOnly ? 'Fechar' : 'Cancelar'}</Button>
          {!readOnly && <Button disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AvailabilityEditor({ employeeId }: { employeeId: string }) {
  const { s, run } = useSnapshot();
  const today = todayISO();
  const [mode, setMode] = useState<'saturday' | 'period'>('saturday');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const upcomingSats = useMemo(() => {
    const d = new Date();
    const out: string[] = [];
    for (let i = 0; i < 4; i++) {
      const t = new Date(d.getFullYear(), d.getMonth() + i, 1);
      out.push(...saturdaysOfMonth(t.getFullYear(), t.getMonth() + 1));
    }
    return out.filter((x) => x >= today);
  }, [today]);
  const items = s.unavailability.filter((u) => u.employeeId === employeeId).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const valid = mode === 'saturday' ? !!start : !!start && !!end && end >= start;

  const add = async () => {
    const ok = await run((r) => r.addUnavailability({ employeeId, startDate: start, endDate: mode === 'saturday' ? start : end, reason: reason.trim() || null }), 'Indisponibilidade registrada.');
    if (ok) { setStart(''); setEnd(''); setReason(''); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-4">
        <div className="mb-3 flex gap-2">
          {(['saturday', 'period'] as const).map((m) => (
            <Button key={m} size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setMode(m)}>{m === 'saturday' ? 'Sábado específico' : 'Período (férias, afastamento)'}</Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {mode === 'saturday' ? (
            <Field label="Sábado">
              <Select value={start} onChange={(e) => setStart(e.target.value)}>
                <option value="">Selecione…</option>
                {upcomingSats.map((d) => <option key={d} value={d}>{fmtFull(d)}</option>)}
              </Select>
            </Field>
          ) : (
            <>
              <Field label="De"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label="Até" error={end && start && end < start ? 'Data final antes da inicial' : undefined}><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            </>
          )}
          <Field label="Motivo (interno)" className={mode === 'saturday' ? 'sm:col-span-2' : ''}><Input value={reason} maxLength={80} onChange={(e) => setReason(e.target.value)} placeholder="Opcional" /></Field>
        </div>
        <Button className="mt-3" size="sm" disabled={!valid} onClick={add}><CalendarPlus />Registrar indisponibilidade</Button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma indisponibilidade registrada. A pessoa é considerada disponível em todos os sábados enquanto estiver ativa.</p>}
        {items.map((u) => (
          <div key={u.id} className={cn('flex items-center gap-3 rounded-xl border border-border px-3 py-2', u.endDate < today && 'opacity-50')}>
            <div className="flex-1">
              <p className="text-sm font-semibold">{u.startDate === u.endDate ? fmtFull(u.startDate) : `${fmtFull(u.startDate)} a ${fmtFull(u.endDate)}`}</p>
              {u.reason && <p className="text-xs text-muted-foreground">{u.reason}</p>}
            </div>
            <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => run((r) => r.removeUnavailability(u.id), 'Removido.')}><Trash2 /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
