import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { fmtFull, monthLabel } from '@/domain/dates';
import type { DayView } from '@/domain/validate';
import type { Requirement } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Switch } from '@/components/ui/form';
import { Dot } from '@/components/ui/misc';
import { useLookups } from './lookups';
import { weekdayLabel } from './DayCard';

/** Cadastro de feriado / jornada extraordinária (ex.: 02/11 — rega). */
export function ExtraDayDialog({ open, onOpenChange, day, year, month }: {
  open: boolean; onOpenChange: (o: boolean) => void; day?: DayView; year?: number; month?: number;
}) {
  const { s, run } = useSnapshot();
  const L = useLookups();
  const editing = !!day;
  const y = year ?? Number(day?.date.slice(0, 4));
  const m = month ?? Number(day?.date.slice(5, 7));
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const lastIso = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;

  const [date, setDate] = useState(day?.date ?? '');
  const [label, setLabel] = useState(day?.label ?? '');
  const [start, setStart] = useState(day?.startTime ?? s.settings.startTime);
  const [end, setEnd] = useState(day?.endTime ?? s.settings.endTime);
  const [ideal, setIdeal] = useState(day?.idealSize ?? Math.min(2, s.settings.maxPerDay));
  const [counts, setCounts] = useState(day?.countsInQuota ?? true);
  const [reqs, setReqs] = useState<Requirement[]>(() =>
    L.skillsSorted.map((k) => day?.requirements?.find((r) => r.skillId === k.id) ?? { skillId: k.id, minCount: 0, mandatory: true }),
  );
  const [saving, setSaving] = useState(false);

  const existing = s.workDays.find((w) => w.date === date);
  const errors: string[] = [];
  if (!date) errors.push('Escolha a data.');
  else if (date < first || date > lastIso) errors.push(`A data deve estar em ${monthLabel(y, m)}.`);
  else if (!editing && existing) errors.push(existing.kind === 'extra' ? 'Já existe uma data extra neste dia.' : 'Este dia já é um sábado regular da escala.');
  if (end <= start) errors.push('O encerramento deve ser após o início.');
  if (ideal < 1 || ideal > s.settings.maxPerDay) errors.push(`Equipe entre 1 e ${s.settings.maxPerDay} (limite de transporte).`);
  const mandatoryTotal = reqs.filter((r) => r.mandatory).reduce((n, r) => n + r.minCount, 0);
  if (mandatoryTotal > ideal) errors.push(`As atividades obrigatórias somam ${mandatoryTotal} pessoas, acima da equipe de ${ideal}.`);

  const save = async () => {
    setSaving(true);
    const ok = await run(
      (r) => r.saveExtraDay({ date, label, startTime: start, endTime: end, idealSize: ideal, countsInQuota: counts, requirements: reqs.filter((x) => x.minCount > 0) }),
      editing ? 'Data extra atualizada.' : 'Data extra adicionada ao quadro do mês.',
    );
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarPlus className="h-5 w-5 text-amber-600" />{editing ? 'Editar data extra' : 'Nova data extra'}</DialogTitle>
          <DialogDescription>Feriado ou jornada extraordinária (ex.: rega em feriado prolongado). Aparece no quadro do mês junto com os sábados.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data" hint={date ? `${weekdayLabel(date)}, ${fmtFull(date)}` : undefined}>
              <Input type="date" min={first} max={lastIso} disabled={editing} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Equipe ideal" hint={`Máximo ${s.settings.maxPerDay} (transporte).`}>
              <Input type="number" min={1} max={s.settings.maxPerDay} value={ideal} onChange={(e) => setIdeal(+e.target.value)} />
            </Field>
            <Field label="Motivo (aparece na escala impressa)" className="sm:col-span-2">
              <Input value={label} maxLength={80} placeholder="Ex.: Finados — manutenção de rega" onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Início"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Encerramento"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-border p-3">
            <Switch checked={counts} onCheckedChange={setCounts} />
            <span className="text-sm">
              <b>{counts ? 'Conta na cota do mês' : 'Não conta na cota do mês'}</b>
              <span className="block text-xs text-muted-foreground">
                {counts ? 'Quem trabalhar neste dia usa uma das suas participações do mês.' : 'Participação extra: aparece nos relatórios de presença, mas não consome a cota.'}
              </span>
            </span>
          </label>

          <div>
            <p className="mb-2 text-[13px] font-semibold text-slate-700">Atividades necessárias neste dia</p>
            <div className="divide-y divide-slate-100 rounded-xl border border-border">
              {reqs.map((r, i) => (
                <div key={r.skillId} className="flex items-center gap-3 px-3 py-2">
                  <Dot color={L.skillColor(r.skillId)} />
                  <span className="flex-1 text-sm font-semibold">{L.skillName(r.skillId)}</span>
                  <span className="text-xs text-muted-foreground">mínimo</span>
                  <Input type="number" min={0} max={ideal} className="h-8 w-16" value={r.minCount}
                    onChange={(e) => setReqs(reqs.map((x, j) => (j === i ? { ...x, minCount: Math.max(0, +e.target.value) } : x)))} />
                  <label className="flex w-28 items-center gap-2 text-xs font-semibold">
                    <Switch checked={r.mandatory} onCheckedChange={(v) => setReqs(reqs.map((x, j) => (j === i ? { ...x, mandatory: v } : x)))} />
                    {r.mandatory ? 'Obrigatória' : 'Preferência'}
                  </label>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Não encontrou “Rega”? Cadastre em Colaboradores → Habilidades e marque quem pode fazer.</p>
          </div>
          {errors.length > 0 && date && <ul className="list-disc rounded-lg bg-red-50 py-2 pl-8 pr-3 text-xs font-medium text-red-700">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={errors.length > 0 || saving} onClick={save}>{saving ? 'Salvando…' : editing ? 'Salvar' : 'Adicionar ao mês'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
