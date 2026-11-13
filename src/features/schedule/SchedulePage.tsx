import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, CalendarPlus, ClipboardCheck, Lock, MousePointerClick, PencilRuler, Printer, RefreshCw, Send, Sparkles, Unlock } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { monthLabel } from '@/domain/dates';
import { hasErrors } from '@/domain/validate';
import { SCHEDULE_STATUS_LABEL } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge, EmptyState, PageHeader, TabsList, TabsRoot, TabsTrigger, Tip } from '@/components/ui/misc';
import { MonthPicker } from '@/components/layout/MonthPicker';
import { cn } from '@/lib/utils';
import { DayCard, type CardMode } from './DayCard';
import { GenerateDialog } from './GenerateDialog';
import { IssueList } from './IssueList';
import { ExtraDayDialog } from './ExtraDayDialog';
import { QuotaBank, type Placing } from './QuotaBank';
import { quotasFor } from '@/domain/stats';
import { todayISO, useLookups, useMonthView } from './lookups';

export const STATUS_COLORS = { draft: '#64748b', published: '#047857', closed: '#155e75' } as const;

export function SchedulePage() {
  const { s, year, month, can, run } = useSnapshot();
  const L = useLookups();
  const { days, issues, schedule } = useMonthView(year, month);
  const hasQuotas = !!quotasFor(s, year, month);
  const [gen, setGen] = useState<null | 'all' | 'remaining'>(null);
  const [mode, setMode] = useState<CardMode>(can.edit ? 'edit' : 'view');
  const [confirm, setConfirm] = useState<null | 'publish' | 'close' | 'reopen'>(null);
  const [manual, setManual] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const today = todayISO();
  const closed = schedule?.status === 'closed';
  const invalid = hasErrors(issues);
  const hasAny = days.some((d) => d.members.length > 0);

  const monthCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of days) for (const m of d.members) if (m.employeeId) c.set(m.employeeId, (c.get(m.employeeId) ?? 0) + 1);
    return s.employees.filter((e) => e.status === 'active' || c.has(e.id)).map((e) => ({ e, n: c.get(e.id) ?? 0 })).sort((a, b) => b.n - a.n || a.e.shortName.localeCompare(b.e.shortName));
  }, [days, s.employees]);

  const effectiveMode: CardMode = !can.edit ? 'view' : mode;

  return (
    <div>
      <PageHeader
        title="Escalas"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {monthLabel(year, month)} · {days.filter((d) => d.kind !== 'extra').length} sábados
            {days.some((d) => d.kind === 'extra') && <> + {days.filter((d) => d.kind === 'extra').length} data(s) extra(s)</>}
            {schedule && <Badge color={STATUS_COLORS[schedule.status]}>{SCHEDULE_STATUS_LABEL[schedule.status]}</Badge>}
            {hasAny && (invalid ? <Badge className="bg-red-100 text-red-700">Operacionalmente inválida</Badge> : <Badge className="bg-emerald-100 text-emerald-800">Operacionalmente válida</Badge>)}
          </span>
        }
        actions={
          <>
            <MonthPicker />
            {can.edit && !closed && <Button variant="outline" onClick={() => setExtraOpen(true)}><CalendarPlus />Data extra</Button>}
            {can.edit && !closed && (
              hasAny ? (
                <>
                  <Button variant="outline" onClick={() => setGen('remaining')}><RefreshCw />Regerar restantes</Button>
                  <Button onClick={() => setGen('all')}><Sparkles />{hasQuotas ? 'Preencher automaticamente' : 'Gerar escala'}</Button>
                </>
              ) : (
                <Button onClick={() => setGen('all')}><Sparkles />Gerar escala</Button>
              )
            )}
          </>
        }
      />

      {!hasAny && !schedule && !manual ? (
        <EmptyState
          icon={<CalendarCheck2 className="h-6 w-6" />}
          title={`Nenhuma escala para ${monthLabel(year, month)}`}
          description={can.edit ? 'Gere uma sugestão automática equilibrada (você revisa antes de salvar) ou monte a escala manualmente, escolhendo cada pessoa.' : 'A escala deste mês ainda não foi publicada.'}
          action={can.edit && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setGen('all')}><Sparkles />Gerar automaticamente</Button>
              <Button variant="outline" onClick={() => setManual(true)}><PencilRuler />Montar manualmente</Button>
            </div>
          )}
        />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-border bg-white p-3 shadow-sm lg:flex-row lg:items-center">
            {can.edit && (
              <TabsRoot value={effectiveMode} onValueChange={(v) => setMode(v as CardMode)}>
                <TabsList>
                  <TabsTrigger value="edit"><PencilRuler className="mr-1.5 inline h-4 w-4" />Montar escala</TabsTrigger>
                  <TabsTrigger value="attendance"><ClipboardCheck className="mr-1.5 inline h-4 w-4" />Presença</TabsTrigger>
                  <TabsTrigger value="view">Visualizar</TabsTrigger>
                </TabsList>
              </TabsRoot>
            )}
            <p className="flex-1 text-xs text-muted-foreground">
              {effectiveMode === 'edit' && !closed && <><MousePointerClick className="mr-1 inline h-3.5 w-3.5" />Arraste nomes do banco para as datas. Dentro do quadro: sobre outra pessoa troca, sobre outro cartão move. “⋯” substitui, muda atividade, reserva vaga ou bloqueia.</>}
              {effectiveMode === 'attendance' && 'Registre quem compareceu (✓) ou faltou (✕). Para ausentes, registre o substituto — o histórico guarda os dois.'}
              {closed && 'Escala encerrada: somente consulta.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" asChild><Link to="/impressao"><Printer />Imprimir</Link></Button>
              {can.edit && schedule?.status === 'draft' && (
                <Tip content={invalid ? 'Resolva as restrições obrigatórias antes de publicar.' : 'Publica para o perfil visualizador e para o quadro de avisos.'}>
                  <span><Button disabled={invalid} variant="secondary" onClick={() => setConfirm('publish')}><Send />Confirmar e publicar</Button></span>
                </Tip>
              )}
              {can.edit && schedule?.status === 'published' && <Button variant="outline" onClick={() => setConfirm('close')}><Lock />Encerrar mês</Button>}
              {can.admin && closed && <Button variant="outline" onClick={() => setConfirm('reopen')}><Unlock />Reabrir</Button>}
            </div>
          </div>

          <div className="mb-5"><IssueList issues={issues} /></div>

          <div className={cn('grid gap-5', effectiveMode === 'edit' && !closed && 'lg:grid-cols-[300px_minmax(0,1fr)]')}>
            {effectiveMode === 'edit' && !closed && (
              <QuotaBank year={year} month={month} days={days} placing={placing} setPlacing={setPlacing} />
            )}
            <div className={cn('grid content-start gap-5 md:grid-cols-2', effectiveMode !== 'edit' && days.length >= 5 && '2xl:grid-cols-3')}>
              {days.map((d) => (
                <DayCard key={d.date} day={d} mode={effectiveMode} issues={issues.filter((i) => i.date === d.date)} isPast={d.date < today} closed={closed} allDays={days}
                  placing={placing} onPlaced={() => setPlacing(null)} />
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold">Frequência no mês</p>
              <Link to="/frequencia" className="text-xs font-semibold text-emerald-700 hover:underline">Ver relatórios completos →</Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {monthCounts.map(({ e, n }) => (
                <span key={e.id} className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm', n === 0 ? 'border-dashed border-slate-300 text-slate-500' : 'border-border bg-slate-50')}>
                  <span className="font-semibold">{e.shortName}</span>
                  <span className="rounded-full px-1.5 text-xs font-extrabold text-white" style={{ backgroundColor: n === 0 ? '#94a3b8' : n > s.settings.maxPerMonth ? '#b45309' : L.sector.get(e.sectorId ?? '')?.color ?? '#047857' }}>{n}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {extraOpen && <ExtraDayDialog open onOpenChange={setExtraOpen} year={year} month={month} />}
      {gen && <GenerateDialog open onOpenChange={(o) => !o && setGen(null)} year={year} month={month} onlyRemaining={gen === 'remaining'} />}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === 'publish' ? 'Confirmar e publicar escala?' : confirm === 'close' ? 'Encerrar a escala do mês?' : 'Reabrir escala encerrada?'}</DialogTitle>
            <DialogDescription>{monthLabel(year, month)}</DialogDescription>
          </DialogHeader>
          <DialogBody className="text-sm text-slate-600">
            {confirm === 'publish' && 'A escala ficará disponível para os visualizadores e pronta para o quadro de avisos. Alterações posteriores continuam possíveis e ficam registradas no histórico.'}
            {confirm === 'close' && 'Todos os sábados serão bloqueados e nenhuma alteração (inclusive presença) poderá ser feita. Registre as presenças antes de encerrar.'}
            {confirm === 'reopen' && 'A escala volta ao estado publicado. Os sábados continuam bloqueados até serem desbloqueados individualmente.'}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button onClick={async () => {
              const status = confirm === 'publish' ? 'published' : confirm === 'close' ? 'closed' : 'published';
              if (await run((r) => r.setScheduleStatus(year, month, status), status === 'closed' ? 'Escala encerrada.' : 'Escala publicada.')) setConfirm(null);
            }}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
