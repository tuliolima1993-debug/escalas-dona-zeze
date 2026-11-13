import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ArrowRight, CalendarDays, CircleDashed, Dna, Scale, Sparkles, Users, UsersRound } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { fmtDayMonth, toISO } from '@/domain/dates';
import { dashboardKpis } from '@/domain/stats';
import { SCHEDULE_STATUS_LABEL } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogDescription } from '@/components/ui/dialog';
import { Badge, Dot, PageHeader } from '@/components/ui/misc';
import { MonthPicker } from '@/components/layout/MonthPicker';
import { cn } from '@/lib/utils';
import { DayCard } from '../schedule/DayCard';
import { IssueList } from '../schedule/IssueList';
import { todayISO, useLookups, useMonthView } from '../schedule/lookups';
import { STATUS_COLORS } from '../schedule/SchedulePage';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function Kpi({ icon, label, value, sub, accent, progress }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; accent: string; progress?: number }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div className="flex items-start justify-between">
        <p className="text-[13px] font-semibold text-muted-foreground">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4" style={{ backgroundColor: accent + '1a', color: accent }}>{icon}</span>
      </div>
      <p className="mt-1 text-[28px] font-extrabold leading-tight tracking-tight text-slate-900">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, progress * 100)}%`, backgroundColor: accent }} />
        </div>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { s, year, month, can, profile } = useSnapshot();
  const L = useLookups();
  const { days, issues, schedule } = useMonthView(year, month);
  const k = useMemo(() => dashboardKpis(s, year, month, L.mandatorySkillIds), [s, year, month, L.mandatorySkillIds]);
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayISO();

  const weeks = useMemo(() => {
    const first = startOfWeek(startOfMonth(new Date(year, month - 1, 1)));
    const last = endOfWeek(endOfMonth(new Date(year, month - 1, 1)));
    const out: Date[][] = [];
    for (let d = first; d <= last; d = addDays(d, 7)) out.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    return out;
  }, [year, month]);

  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const selectedDay = selected ? dayByDate.get(selected) : undefined;
  const next = days.find((d) => d.date >= today);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div>
      <PageHeader
        title={`${greet}, ${profile?.name.split(' ')[0] ?? ''}`}
        description={<span className="flex items-center gap-2">Panorama das escalas de sábado {schedule && <Badge color={STATUS_COLORS[schedule.status]}>{SCHEDULE_STATUS_LABEL[schedule.status]}</Badge>}</span>}
        actions={<><MonthPicker />{can.edit && <Button asChild><Link to="/escalas"><Sparkles />Abrir escala</Link></Button>}</>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={<Users />} label="Colaboradores ativos" value={k.activeEmployees} sub={`${s.employees.length} cadastrados`} accent="#047857" />
        <Kpi icon={<CalendarDays />} label="Sábados do mês" value={k.saturdays} sub={k.extraDays ? `+ ${k.extraDays} data(s) extra(s)` : `${s.settings.startTime.replace(':00', 'h')} às ${s.settings.endTime.replace(':00', 'h')}`} accent="#155e75" />
        <Kpi icon={<UsersRound />} label="Participações previstas" value={k.filled} sub={`de ${k.capacity} vagas ideais`} accent="#0f766e" progress={k.capacity ? k.filled / k.capacity : 0} />
        <Kpi icon={<Dna />} label="Cobertura da clonagem" value={<>{k.cloningCovered}<span className="text-lg text-slate-400">/{k.saturdays}</span></>} sub={k.cloningCovered === k.saturdays ? 'Todos os sábados cobertos' : `${k.saturdays - k.cloningCovered} sábado(s) sem cobertura`} accent="#7c3aed" progress={k.saturdays ? k.cloningCovered / k.saturdays : 0} />
        <Kpi icon={<CircleDashed />} label="Vagas pendentes" value={k.pending} sub={k.reserved ? `${k.reserved} reservada(s) a confirmar` : 'nenhuma reserva'} accent={k.pending ? '#d97706' : '#047857'} />
        <Kpi icon={<Scale />} label="Distribuição" value={<>{k.distribution.min}–{k.distribution.max}</>} sub={`mín–máx · média ${k.distribution.avg.toFixed(1).replace('.', ',')} por pessoa`} accent={k.distribution.max - k.distribution.min > 1 ? '#d97706' : '#047857'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold">Calendário do mês</h2>
            <div className="flex flex-wrap gap-3">
              {L.skillsSorted.map((sk) => <span key={sk.id} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Dot color={sk.color} />{sk.name}</span>)}
            </div>
          </div>
          <div className="grid gap-1.5 text-center sm:grid-cols-[repeat(6,minmax(0,1fr))_minmax(0,2.6fr)] text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {WEEKDAYS.map((w) => <div key={w} className={cn('hidden pb-1 sm:block', w === 'Sáb' && 'text-emerald-700')}>{w}</div>)}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-[repeat(6,minmax(0,1fr))_minmax(0,2.6fr)]">
            {weeks.flat().map((d) => {
              const iso = toISO(d);
              const inMonth = isSameMonth(d, new Date(year, month - 1, 1));
              const sat = d.getDay() === 6 && inMonth;
              const day = dayByDate.get(iso);
              const dayIssues = issues.filter((i) => i.date === iso);
              const err = dayIssues.some((i) => i.severity === 'error');
              const extraDay = inMonth && day?.kind === 'extra';
              if (!sat && !extraDay) {
                return (
                  <div key={iso} className={cn('hidden min-h-[54px] rounded-lg p-1.5 text-left text-xs sm:block lg:min-h-[112px]', inMonth ? 'bg-slate-50 text-slate-400' : 'text-slate-200', iso === today && 'ring-2 ring-emerald-400')}>
                    {format(d, 'd')}
                  </div>
                );
              }
              return (
                <button
                  key={iso}
                  onClick={() => setSelected(iso)}
                  className={cn(
                    'flex min-h-[112px] flex-col rounded-xl border-2 bg-white p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
                    err ? 'border-red-300' : extraDay ? 'border-amber-300 bg-amber-50/60 hover:border-amber-400' : 'border-emerald-200 hover:border-emerald-400',
                    iso === today && 'ring-2 ring-emerald-400',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cn('text-sm font-extrabold', extraDay ? 'text-amber-800' : 'text-forest-800')}>{format(d, 'd')}{extraDay && <span className="ml-1 text-[10px] uppercase">extra</span>}</span>
                    <span className="flex gap-0.5">
                      {day?.members.map((m) => <span key={m.key} className={cn('h-2 w-2 rounded-full', !m.employeeId && 'border bg-white')} style={m.employeeId ? { backgroundColor: L.skillColor(m.activityId) } : { borderColor: L.skillColor(m.requiredSkillId) }} />)}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {day?.members.map((m) => (
                      <p key={m.key} className={cn('flex items-center gap-1.5 truncate text-[12.5px] font-semibold leading-snug', m.employeeId ? 'text-slate-700' : 'italic text-slate-400')}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: L.skillColor(m.activityId ?? m.requiredSkillId) }} />
                        <span className="truncate">{m.employeeId ? L.empName(m.employeeId) : m.reservedLabel}</span>
                      </p>
                    ))}
                    {!day?.members.length && <p className="text-[11px] text-slate-400">Sem equipe</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="bg-forest-900 bg-leaf px-5 py-4 text-white">
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Próximo sábado</p>
              <p className="text-xl font-extrabold">{next ? fmtDayMonth(next.date) : '—'}</p>
            </div>
            <div className="p-4">
              {next ? (
                <ul className="space-y-2">
                  {next.members.map((m) => (
                    <li key={m.key} className="flex items-center gap-2.5 text-sm">
                      <Dot color={L.skillColor(m.activityId ?? m.requiredSkillId)} />
                      <span className={cn('flex-1 font-semibold', !m.employeeId && 'italic text-slate-400')}>{m.employeeId ? L.empName(m.employeeId) : m.reservedLabel}</span>
                      <span className="text-xs text-muted-foreground">{L.skillName(m.activityId ?? m.requiredSkillId)}</span>
                    </li>
                  ))}
                  {!next.members.length && <p className="text-sm text-muted-foreground">Equipe ainda não definida.</p>}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Não há mais sábados neste mês.</p>}
              {next && <Button variant="soft" size="sm" className="mt-3 w-full" onClick={() => setSelected(next.date)}>Ver detalhes <ArrowRight /></Button>}
            </div>
          </Card>
          <div>
            <p className="mb-2 text-sm font-bold">Alertas do mês</p>
            <IssueList issues={issues.filter((i) => i.severity !== 'info')} compact />
          </div>
        </div>
      </div>

      <Dialog open={!!selectedDay} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent side>
          <DialogHeader>
            <DialogTitle>Equipe do sábado</DialogTitle>
            <DialogDescription>{selectedDay && fmtDayMonth(selectedDay.date)}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 bg-slate-50/60">
            {selectedDay && <DayCard day={selectedDay} mode="view" issues={issues.filter((i) => i.date === selectedDay.date)} allDays={days} />}
            {selectedDay && <IssueList issues={issues.filter((i) => i.date === selectedDay.date)} compact />}
            {can.edit && <Button asChild className="w-full"><Link to="/escalas">Editar na tela de escalas</Link></Button>}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
