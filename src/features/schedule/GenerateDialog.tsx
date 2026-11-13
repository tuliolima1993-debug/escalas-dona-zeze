import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, Sparkles, XCircle } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { fmtShort, monthLabel } from '@/domain/dates';
import { checkAvailability } from '@/domain/eligibility';
import { quotasFor } from '@/domain/stats';
import { buildGenerateInput, resultToCommit } from '@/domain/generate-input';
import { generateSchedule, WEIGHTS, type GenerateOptions, type GenerateResult } from '@/domain/scheduler';
import type { BalancePriority, Requirement } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Switch } from '@/components/ui/form';
import { Badge, Dot } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { DayCard } from './DayCard';
import { IssueList } from './IssueList';
import { todayISO, useLookups, useMonthView } from './lookups';

export function GenerateDialog({ open, onOpenChange, year, month, onlyRemaining }: {
  open: boolean; onOpenChange: (o: boolean) => void; year: number; month: number; onlyRemaining?: boolean;
}) {
  const { s, run } = useSnapshot();
  const L = useLookups();
  const { days: currentDays, schedule } = useMonthView(year, month);
  const st = s.settings;
  const today = todayISO();

  const [ideal, setIdeal] = useState(st.idealPerDay);
  const [max, setMax] = useState(st.maxPerDay);
  const [start, setStart] = useState(st.startTime);
  const [end, setEnd] = useState(st.endTime);
  const [maxPerMonth, setMaxPerMonth] = useState(st.maxPerMonth);
  const [avoidConsecutive, setAvoidConsecutive] = useState(st.avoidConsecutive);
  const [priority, setPriority] = useState<BalancePriority>(st.balancePriority);
  const [reqs, setReqs] = useState<Requirement[]>(() =>
    L.skillsSorted.map((k) => s.requirements.find((r) => r.skillId === k.id) ?? { skillId: k.id, minCount: 0, mandatory: false }),
  );
  const active = s.employees.filter((e) => e.status === 'active');
  const [available, setAvailable] = useState<string[]>(active.map((e) => e.id));
  const [scope, setScope] = useState<'all' | 'remaining'>(onlyRemaining ? 'remaining' : 'all');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [saving, setSaving] = useState(false);

  const regenDates = useMemo(() => {
    const open = currentDays.filter((d) => !d.locked);
    return (scope === 'remaining' ? open.filter((d) => d.date >= today) : open).map((d) => d.date);
  }, [currentDays, scope, today]);
  const lockedCount = currentDays.filter((d) => d.locked).length;
  const hasExisting = currentDays.some((d) => d.workDay && d.members.length > 0 && regenDates.includes(d.date));

  const invalid = ideal < 1 || max < 1 || ideal > max || end <= start || regenDates.length === 0;

  const generate = () => {
    const overrides: Partial<GenerateOptions> = {
      idealPerDay: ideal, maxPerDay: max, startTime: start, endTime: end, maxPerMonth, avoidConsecutive,
      balancePriority: priority, requirements: reqs.filter((r) => r.minCount > 0), availableEmployeeIds: available,
      regenerateDates: regenDates,
    };
    setResult(generateSchedule(buildGenerateInput(s, year, month, overrides)));
    setConfirmReplace(false);
  };

  const save = async () => {
    if (!result) return;
    if (schedule?.status === 'published' && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setSaving(true);
    const ok = await run((r) => r.commitMonth(resultToCommit(result, year, month)), 'Escala salva com sucesso.');
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  const reasons = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    result?.days.forEach((d) => d.members.forEach((x) => (m[x.key] = x.reason)));
    return m;
  }, [result]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-emerald-600" />{result ? 'Prévia da escala' : 'Gerar escala'} — {monthLabel(year, month)}</DialogTitle>
          <DialogDescription>
            {result ? 'Confira a sugestão. Nada foi salvo ainda: ajuste os parâmetros ou confirme.' : 'Defina os parâmetros. O motor distribui as vagas de forma equilibrada, determinística e explicável.'}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <DialogBody className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <div className="space-y-5">
              <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Equipe ideal"><Input type="number" min={1} max={30} value={ideal} onChange={(e) => setIdeal(+e.target.value)} /></Field>
                <Field label="Máximo (transporte)" error={ideal > max ? 'Menor que o ideal' : undefined}><Input type="number" min={1} max={30} value={max} onChange={(e) => setMax(+e.target.value)} /></Field>
                <Field label="Início"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                <Field label="Encerramento" error={end <= start ? 'Inválido' : undefined}><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
              </section>

              <section>
                <p className="mb-2 text-[13px] font-semibold text-slate-700">Necessidades por atividade (por sábado)</p>
                <div className="divide-y divide-slate-100 rounded-xl border border-border">
                  {reqs.map((r, i) => (
                    <div key={r.skillId} className="flex items-center gap-3 px-3 py-2">
                      <Dot color={L.skillColor(r.skillId)} />
                      <span className="flex-1 text-sm font-semibold">{L.skillName(r.skillId)}</span>
                      <span className="text-xs text-muted-foreground">mínimo</span>
                      <Input type="number" min={0} max={max} className="h-8 w-16" value={r.minCount}
                        onChange={(e) => setReqs(reqs.map((x, j) => (j === i ? { ...x, minCount: Math.max(0, +e.target.value) } : x)))} />
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                        <Switch checked={r.mandatory} onCheckedChange={(v) => setReqs(reqs.map((x, j) => (j === i ? { ...x, mandatory: v } : x)))} />
                        {r.mandatory ? 'Obrigatória' : 'Preferência'}
                      </label>
                    </div>
                  ))}
                </div>
              </section>

              {quotasFor(s, year, month) && (
                <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                  Banco de participações ativo: o preenchimento respeita exatamente a cota de cada pessoa (o limite mensal abaixo é ignorado). Datas extras usam a própria equipe e atividades.
                </p>
              )}
              <section className="grid gap-4 sm:grid-cols-3">
                <Field label="Máx. de sábados por pessoa no mês"><Input type="number" min={1} max={5} value={maxPerMonth} onChange={(e) => setMaxPerMonth(+e.target.value)} /></Field>
                <Field label="Prioridade de equilíbrio">
                  <Select value={priority} onChange={(e) => setPriority(e.target.value as BalancePriority)}>
                    <option value="high">Alta (diferença máx. de 1)</option>
                    <option value="medium">Média</option>
                    <option value="low">Baixa (prioriza intervalos)</option>
                  </Select>
                </Field>
                <Field label="Sábados consecutivos">
                  <label className="flex h-10 items-center gap-2 text-sm"><Switch checked={avoidConsecutive} onCheckedChange={setAvoidConsecutive} />Evitar</label>
                </Field>
              </section>

              <section>
                <p className="mb-2 text-[13px] font-semibold text-slate-700">Sábados a gerar</p>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'remaining'] as const).map((k) => (
                    <button key={k} onClick={() => setScope(k)} className={cn('rounded-xl border px-3 py-2 text-left text-sm transition', scope === k ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-border hover:bg-slate-50')}>
                      <p className="font-bold">{k === 'all' ? 'Todos os não bloqueados' : 'Somente os restantes'}</p>
                      <p className="text-xs text-muted-foreground">{k === 'all' ? 'Gera o mês inteiro' : `A partir de ${fmtShort(today)}`}</p>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Serão gerados: {regenDates.length ? regenDates.map(fmtShort).join(', ') : 'nenhum sábado'}
                  {lockedCount > 0 && <> · {lockedCount} bloqueado(s) preservado(s)</>}
                </p>
              </section>
            </div>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[13px] font-semibold text-slate-700">Pessoas disponíveis ({available.length})</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setAvailable(active.map((e) => e.id))}>Todas</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAvailable([])}>Nenhuma</Button>
                </div>
              </div>
              <div className="max-h-[420px] space-y-1 overflow-y-auto rounded-xl border border-border p-1.5 scrollbar-thin">
                {s.employees.filter((e) => e.status !== 'inactive').map((e) => {
                  const blocked = currentDays.filter((d) => !checkAvailability(e, d.date, s.unavailability).ok);
                  const isActive = e.status === 'active';
                  return (
                    <label key={e.id} className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-slate-50', !isActive && 'cursor-not-allowed opacity-50')}>
                      <Checkbox disabled={!isActive} checked={available.includes(e.id)} onCheckedChange={(v) => setAvailable(v ? [...available, e.id] : available.filter((x) => x !== e.id))} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{e.shortName}</p>
                        <p className="text-xs text-muted-foreground">
                          {L.sector.get(e.sectorId ?? '')?.name}
                          {!isActive && ` · ${checkAvailability(e, today, []).reason}`}
                          {isActive && blocked.length > 0 && ` · indisponível em ${blocked.map((d) => fmtShort(d.date)).join(', ')}`}
                        </p>
                      </div>
                      <div className="flex gap-1">{e.skillIds.map((id) => <Dot key={id} color={L.skillColor(id)} />)}</div>
                    </label>
                  );
                })}
              </div>
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                <p className="mb-1 flex items-center gap-1.5 font-bold text-slate-700"><Info className="h-3.5 w-3.5" />Como a pontuação funciona</p>
                Cada candidato recebe pontos (menor = melhor): {WEIGHTS[priority].month} × sábados já no mês + {WEIGHTS[priority].history} × histórico acima da média
                + {WEIGHTS[priority].consecutive} se for sábado consecutivo + {WEIGHTS[priority].gap} por semana abaixo do intervalo preferido + {WEIGHTS[priority].pair} por dupla repetida.
                Atividades obrigatórias são cobertas primeiro, com busca completa de alternativas.
              </div>
            </section>
          </DialogBody>
        ) : (
          <DialogBody className="space-y-5 bg-slate-50/60">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Summary label="Situação" value={result.valid ? 'Válida' : 'Com conflitos'} tone={result.valid ? 'ok' : 'bad'} icon={result.valid ? <CheckCircle2 /> : <XCircle />} />
              <Summary label="Vagas preenchidas" value={`${result.filled} de ${result.slots}`} tone={result.filled < result.slots ? 'warn' : 'ok'} />
              <Summary label="Diferença máx. no mês" value={`${result.summary.spread} sábado(s)`} tone={result.summary.spread > 1 ? 'warn' : 'ok'} />
              <Summary label="Sábados consecutivos" value={String(result.summary.consecutive)} tone={result.summary.consecutive ? 'warn' : 'ok'} />
              <Summary label="Duplas repetidas" value={String(result.summary.repeatedPairs)} tone="neutral" />
            </div>
            {result.issues.length > 0 && <IssueList issues={result.issues} />}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {result.days.map((d) => <DayCard key={d.date} day={d} mode="preview" reasons={reasons} issues={result.issues.filter((i) => i.date === d.date)} compact />)}
            </div>
            <div className="rounded-2xl border border-border bg-white p-4">
              <p className="mb-3 text-sm font-bold">Distribuição prevista</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {result.distribution.map((r) => (
                  <div key={r.employeeId} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="flex-1 truncate font-semibold">{r.name}</span>
                    <span className="text-xs text-muted-foreground">histórico {r.history}</span>
                    <Badge color={r.month === 0 ? '#64748b' : '#047857'}>{r.month} no mês</Badge>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Passe o mouse sobre um nome para ver por que a pessoa foi escolhida.</p>
            </div>
          </DialogBody>
        )}

        <DialogFooter>
          {confirmReplace && (
            <p className="mr-auto flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4" />Esta escala já foi publicada. Confirme para substituir os sábados não bloqueados.
            </p>
          )}
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button disabled={invalid} onClick={generate}><Sparkles />Gerar prévia</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setResult(null)}><ArrowLeft />Ajustar parâmetros</Button>
              <Button variant="outline" onClick={generate}>Gerar novamente</Button>
              <Button disabled={saving} variant={confirmReplace ? 'destructive' : 'default'} onClick={save}>
                {saving ? 'Salvando…' : confirmReplace ? 'Substituir escala publicada' : hasExisting ? 'Confirmar e substituir' : 'Confirmar e salvar'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value, tone, icon }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'neutral'; icon?: React.ReactNode }) {
  const tones = { ok: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-red-600', neutral: 'text-slate-800' };
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 flex items-center gap-1.5 text-lg font-extrabold [&_svg]:h-5 [&_svg]:w-5', tones[tone])}>{icon}{value}</p>
    </div>
  );
}
