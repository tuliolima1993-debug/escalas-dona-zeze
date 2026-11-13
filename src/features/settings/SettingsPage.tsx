import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Bus, CalendarClock, Printer, Save, Scale, ShieldAlert } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import type { Requirement, Settings } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { Dot, PageHeader } from '@/components/ui/misc';
import { useLookups } from '../schedule/lookups';

const schema = z.object({
  orgName: z.string().trim().min(3).max(60),
  idealPerDay: z.number().int().min(1).max(30),
  maxPerDay: z.number().int().min(1).max(30),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  maxPerMonth: z.number().int().min(1).max(5),
  minGapWeeks: z.number().int().min(1).max(5),
  considerHistoryMonths: z.number().int().min(0).max(36),
}).refine((v) => v.idealPerDay <= v.maxPerDay, { message: 'A equipe ideal não pode superar o limite de transporte.', path: ['idealPerDay'] })
  .refine((v) => v.endTime > v.startTime, { message: 'O encerramento deve ser após o início.', path: ['endTime'] });

export function SettingsPage() {
  const { s, run, can } = useSnapshot();
  const L = useLookups();
  const [form, setForm] = useState<Settings>(s.settings);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setForm(s.settings);
    setReqs(L.skillsSorted.map((k) => s.requirements.find((r) => r.skillId === k.id) ?? { skillId: k.id, minCount: 0, mandatory: false }));
  }, [s, L.skillsSorted]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const ro = !can.admin;
  const dirty = JSON.stringify(form) !== JSON.stringify(s.settings) || JSON.stringify(reqs.filter((r) => r.minCount > 0)) !== JSON.stringify(s.requirements.filter((r) => r.minCount > 0));

  const save = async () => {
    const r = schema.safeParse(form);
    const errs: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) errs[String(i.path[0])] = i.message;
    const mandatoryTotal = reqs.filter((x) => x.mandatory).reduce((n, x) => n + x.minCount, 0);
    if (mandatoryTotal > form.maxPerDay) errs.reqs = `As atividades obrigatórias somam ${mandatoryTotal} pessoas, acima do limite de transporte.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    await run((rep) => rep.saveSettings(form, reqs.filter((x) => x.minCount > 0)), 'Configurações salvas. Novas gerações usarão estas regras.');
  };

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Regras operacionais usadas pelo motor de escalas e pela impressão. Alterações não mudam escalas já salvas."
        actions={!ro && <Button disabled={!dirty} onClick={save}><Save />Salvar alterações</Button>}
      />
      {ro && <p className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"><ShieldAlert className="h-4 w-4" />Somente administradores podem alterar as configurações.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Bus className="h-4 w-4 text-emerald-700" />Equipe e transporte</CardTitle><CardDescription>O limite de transporte é uma restrição obrigatória.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Equipe ideal por sábado" error={errors.idealPerDay}><Input disabled={ro} type="number" min={1} value={form.idealPerDay} onChange={(e) => set('idealPerDay', +e.target.value)} /></Field>
            <Field label="Limite de passageiros" error={errors.maxPerDay}><Input disabled={ro} type="number" min={1} value={form.maxPerDay} onChange={(e) => set('maxPerDay', +e.target.value)} /></Field>
            <Field label="Início" error={errors.startTime}><Input disabled={ro} type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} /></Field>
            <Field label="Encerramento" error={errors.endTime}><Input disabled={ro} type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} /></Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-violet-700" />Atividades por sábado</CardTitle><CardDescription>Obrigatória = a escala só é válida se atendida. Preferência = o motor tenta atender.</CardDescription></CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100 rounded-xl border border-border">
              {reqs.map((r, i) => (
                <div key={r.skillId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <Dot color={L.skillColor(r.skillId)} />
                  <span className="flex-1 text-sm font-semibold">{L.skillName(r.skillId)}</span>
                  <span className="text-xs text-muted-foreground">mínimo</span>
                  <Input disabled={ro} type="number" min={0} max={form.maxPerDay} className="h-8 w-16" value={r.minCount} onChange={(e) => setReqs(reqs.map((x, j) => (j === i ? { ...x, minCount: Math.max(0, +e.target.value) } : x)))} />
                  <label className="flex w-32 items-center gap-2 text-xs font-semibold">
                    <Switch disabled={ro} checked={r.mandatory} onCheckedChange={(v) => setReqs(reqs.map((x, j) => (j === i ? { ...x, mandatory: v } : x)))} />
                    {r.mandatory ? 'Obrigatória' : 'Preferência'}
                  </label>
                </div>
              ))}
            </div>
            {errors.reqs && <p className="mt-2 text-xs font-semibold text-destructive">{errors.reqs}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Scale className="h-4 w-4 text-petrol-600" />Equilíbrio e repetição</CardTitle><CardDescription>Preferências de distribuição usadas pelo motor.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Máximo de sábados por pessoa no mês" error={errors.maxPerMonth}><Input disabled={ro} type="number" min={1} max={5} value={form.maxPerMonth} onChange={(e) => set('maxPerMonth', +e.target.value)} /></Field>
            <Field label="Intervalo preferido entre participações" hint="Em semanas." error={errors.minGapWeeks}><Input disabled={ro} type="number" min={1} max={5} value={form.minGapWeeks} onChange={(e) => set('minGapWeeks', +e.target.value)} /></Field>
            <Field label="Prioridade de equilíbrio">
              <Select disabled={ro} value={form.balancePriority} onChange={(e) => set('balancePriority', e.target.value as Settings['balancePriority'])}>
                <option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option>
              </Select>
            </Field>
            <Field label="Histórico considerado" hint="0 = todo o histórico." error={errors.considerHistoryMonths}><Input disabled={ro} type="number" min={0} max={36} value={form.considerHistoryMonths} onChange={(e) => set('considerHistoryMonths', +e.target.value)} /></Field>
            <label className="flex items-center gap-3 text-sm font-semibold sm:col-span-2"><Switch disabled={ro} checked={form.avoidConsecutive} onCheckedChange={(v) => set('avoidConsecutive', v)} />Evitar sábados consecutivos para a mesma pessoa</label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Printer className="h-4 w-4 text-amber-700" />Impressão</CardTitle><CardDescription>Padrões do módulo de impressão.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do cultivo no cabeçalho" error={errors.orgName} className="sm:col-span-2"><Input disabled={ro} value={form.orgName} onChange={(e) => set('orgName', e.target.value)} /></Field>
            <Field label="Papel padrão">
              <Select disabled={ro} value={form.print.paper} onChange={(e) => set('print', { ...form.print, paper: e.target.value as 'A4' | 'A3' })}><option value="A4">A4 paisagem</option><option value="A3">A3 paisagem</option></Select>
            </Field>
            <Field label="Rodapé (opcional)" hint="Deixe vazio para não imprimir rodapé."><Input disabled={ro} maxLength={80} value={form.print.footerText} onChange={(e) => set('print', { ...form.print, footerText: e.target.value })} /></Field>
            <label className="flex items-center gap-3 text-sm font-semibold"><Switch disabled={ro} checked={form.print.showActivityCounts} onCheckedChange={(v) => set('print', { ...form.print, showActivityCounts: v })} />Quantidade por atividade</label>
            <label className="flex items-center gap-3 text-sm font-semibold"><Switch disabled={ro} checked={form.print.emptySlotsToIdeal} onCheckedChange={(v) => set('print', { ...form.print, emptySlotsToIdeal: v })} />Linhas em branco para vagas</label>
          </CardContent>
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Cores de setores e habilidades são definidas em Colaboradores → Setores / Habilidades.</p>
    </div>
  );
}
