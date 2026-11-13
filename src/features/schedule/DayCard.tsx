import { useState, type DragEvent } from 'react';
import {
  AlertTriangle, ArrowLeftRight, CalendarPlus, CalendarClock, Check, Clock, GripVertical, Lock, MoreHorizontal, Plus, Repeat2,
  Trash2, Unlock, UserPlus, UserRoundX, Wand2, X,
} from 'lucide-react';
import { useData } from '@/data/DataProvider';
import { fmtDayMonth, fmtShift, fromISO } from '@/domain/dates';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { hasSkill } from '@/domain/eligibility';
import { defaultActivity } from '@/domain/scheduler';
import { countActivities, dayIdeal, dayRequirements, type DayMember, type DayView, type Issue } from '@/domain/validate';
import type { Snapshot, WorkDay } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Badge, Dot, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tip } from '@/components/ui/misc';
import { cn, tint } from '@/lib/utils';
import { useLookups } from './lookups';
import { PersonPickerDialog, SwapDialog, WorkDayDialog } from './dialogs';
import { ExtraDayDialog } from './ExtraDayDialog';

export type CardMode = 'view' | 'edit' | 'attendance' | 'preview';

interface Props {
  day: DayView & { workDay?: WorkDay; regenerated?: boolean };
  issues?: Issue[];
  mode: CardMode;
  reasons?: Record<string, string | undefined>;
  isPast?: boolean;
  compact?: boolean;
  closed?: boolean;
  allDays?: (DayView & { workDay?: WorkDay })[];
  /** Modo toque: pessoa selecionada no banco de cotas, pronta para ser colocada. */
  placing?: { employeeId: string; name: string } | null;
  onPlaced?: () => void;
}

export const EMP_MIME = 'application/x-dzc-employee';

/** Atividade ao colocar alguém no dia: cobre primeiro uma obrigatória que esteja faltando. */
export function pickActivity(s: Snapshot, day: DayView, employeeId: string): string | null {
  const e = s.employees.find((x) => x.id === employeeId);
  if (!e) return null;
  const counts = countActivities(day);
  for (const r of dayRequirements(day, s.requirements).filter((x) => x.minCount > 0).sort((a, b) => Number(b.mandatory) - Number(a.mandatory))) {
    if ((counts[r.skillId]?.confirmed ?? 0) < r.minCount && hasSkill(e, r.skillId)) return r.skillId;
  }
  return defaultActivity(e, s.sectors, s.skills);
}

export const weekdayLabel = (iso: string) => format(fromISO(iso), 'EEEE', { locale: ptBR }).replace('-feira', '');

const DRAG_MIME = 'application/x-dzc-assignment';

export function ActivityCounts({ day, className }: { day: DayView; className?: string }) {
  const L = useLookups();
  const counts = countActivities(day);
  return (
    <div className={cn('flex flex-wrap gap-x-4 gap-y-1.5', className)}>
      {L.skillsSorted.map((k) => {
        const c = counts[k.id];
        const n = c?.confirmed ?? 0;
        return (
          <span key={k.id} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <Dot color={k.color} />
            {k.name}: <span className="text-slate-900">{n} {n === 1 ? 'pessoa' : 'pessoas'}</span>
            {c?.pending ? <span className="font-medium text-slate-400">(+{c.pending} pendente)</span> : null}
          </span>
        );
      })}
    </div>
  );
}

export function DayCard({ day, issues = [], mode, reasons, isPast, compact, closed, allDays = [], placing, onPlaced }: Props) {
  const L = useLookups();
  const { run, snapshot } = useData();
  const settings = snapshot!.settings;
  const [picker, setPicker] = useState<null | { kind: 'add' | 'reserve' | 'replace' | 'fill' | 'activity'; member?: DayMember }>(null);
  const [swapFor, setSwapFor] = useState<DayMember | null>(null);
  const [editDay, setEditDay] = useState(false);
  const [editExtra, setEditExtra] = useState(false);
  const extra = day.kind === 'extra';
  const [dragOver, setDragOver] = useState<string | null>(null);

  const editable = mode === 'edit' && !day.locked && !closed;
  const canDnD = editable;
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const capacityLeft = settings.maxPerDay - day.members.length;
  const emptyRows = Math.max(0, dayIdeal(day, settings) - day.members.length);
  const accepts = (types: readonly string[]) => types.includes(DRAG_MIME) || types.includes(EMP_MIME);

  const placeEmployee = async (employeeId: string) => {
    const ok = await run(
      (r) => r.addAssignment(day.date, { employeeId, activityId: pickActivity(snapshot!, day, employeeId), reservedLabel: null, requiredSkillId: null }),
      `Colocado(a) em ${fmtDayMonth(day.date)}.`,
    );
    if (ok) onPlaced?.();
  };

  const onDrop = (e: DragEvent, targetKey: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const emp = e.dataTransfer.getData(EMP_MIME);
    if (emp) {
      placeEmployee(emp);
      return;
    }
    const id = e.dataTransfer.getData(DRAG_MIME);
    if (!id || id === targetKey) return;
    if (day.members.some((m) => m.key === id)) return; // mesmo sábado
    if (targetKey) run((r) => r.swapAssignments(id, targetKey), 'Troca realizada. Escala revalidada.');
    else run((r) => r.moveAssignment(id, day.date), 'Colaborador movido de sábado.');
  };

  return (
    <div
      className={cn(
        'group/card relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(16,24,40,.05)] transition-all animate-fade-in',
        errors.length ? 'border-red-300 ring-1 ring-red-200' : 'border-border',
        dragOver === 'card' && 'ring-2 ring-emerald-400',
        placing && editable && capacityLeft > 0 && !day.members.some((m) => m.employeeId === placing.employeeId) && 'ring-2 ring-emerald-300 ring-offset-2',
        isPast && mode !== 'attendance' && 'opacity-[.92]',
      )}
      onDragOver={canDnD ? (e) => { if (accepts(e.dataTransfer.types)) { e.preventDefault(); setDragOver('card'); } } : undefined}
      onDragLeave={canDnD ? () => setDragOver(null) : undefined}
      onDrop={canDnD ? (e) => onDrop(e, null) : undefined}
    >
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 border-b-2 border-forest-600 bg-gradient-to-br from-forest-50 to-white px-5 py-3.5">
        <div className="min-w-0">
          <p className={cn('text-[11px] font-extrabold uppercase tracking-[0.14em]', extra ? 'text-amber-700' : 'text-forest-600')}>
            {weekdayLabel(day.date)}{extra && ' · data extra'}{extra && day.countsInQuota === false && ' · fora da cota'}
          </p>
          <p className={cn('font-extrabold uppercase tracking-tight text-forest-950', compact ? 'text-lg' : 'text-xl')}>{fmtDayMonth(day.date)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-petrol-600">
            <Clock className="h-3.5 w-3.5" /> {fmtShift(day.startTime, day.endTime)}
          </p>
          {extra && day.label && <p className="mt-1 text-xs font-semibold text-amber-800">{day.label}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          {day.locked && (
            <Tip content="Sábado bloqueado: preservado em regerações e protegido contra alterações.">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white"><Lock className="h-3 w-3" />Bloqueado</span>
            </Tip>
          )}
          {mode === 'preview' && day.regenerated === false && <Badge>Preservado</Badge>}
          {errors.length > 0 && (
            <Tip content={errors.map((e) => e.message).join('\n')}>
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700"><AlertTriangle className="h-3 w-3" />{errors.length}</span>
            </Tip>
          )}
          {errors.length === 0 && warnings.length > 0 && (
            <Tip content={warnings.map((e) => e.message).join('\n')}>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"><AlertTriangle className="h-3 w-3" />{warnings.length}</span>
            </Tip>
          )}
          {mode === 'edit' && !closed && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ações do sábado"><MoreHorizontal /></Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{fmtDayMonth(day.date)}</MenuLabel>
                <MenuItem disabled={!editable || capacityLeft <= 0} onSelect={() => setPicker({ kind: 'add' })}><UserPlus />Adicionar colaborador</MenuItem>
                <MenuItem disabled={!editable || capacityLeft <= 0} onSelect={() => setPicker({ kind: 'reserve' })}><CalendarClock />Reservar vaga</MenuItem>
                {extra ? (
                  <>
                    <MenuItem onSelect={() => setEditExtra(true)}><CalendarPlus />Editar data extra</MenuItem>
                    <MenuItem className="text-red-600 data-[highlighted]:bg-red-50" onSelect={() => run((r) => r.removeExtraDay(day.date), 'Data extra removida.')}><Trash2 className="!text-red-500" />Excluir data extra</MenuItem>
                  </>
                ) : (
                  <MenuItem disabled={!editable} onSelect={() => setEditDay(true)}><Clock />Horário e observação</MenuItem>
                )}
                <MenuSeparator />
                {day.locked ? (
                  <MenuItem onSelect={() => run((r) => r.setDayLocked(day.date, false), 'Sábado desbloqueado.')}><Unlock />Desbloquear sábado</MenuItem>
                ) : (
                  <MenuItem onSelect={() => run((r) => r.setDayLocked(day.date, true), 'Sábado bloqueado e confirmado.')}><Lock />Bloquear (confirmar) sábado</MenuItem>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>

      {/* Equipe */}
      <ul className="flex-1 divide-y divide-slate-100 px-2 py-1.5">
        {day.members.map((m) => {
          const e = m.employeeId ? L.emp.get(m.employeeId) : undefined;
          const color = L.skillColor(m.activityId ?? m.requiredSkillId);
          const memberIssues = issues.filter((i) => i.employeeId && i.employeeId === m.employeeId);
          const assignment = snapshot!.assignments.find((a) => a.id === m.key);
          const att = assignment?.attendance ?? null;
          return (
            <li
              key={m.key}
              draggable={canDnD && !!m.employeeId}
              onDragStart={(ev) => { ev.dataTransfer.setData(DRAG_MIME, m.key); ev.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={canDnD ? (ev) => { if (ev.dataTransfer.types.includes(DRAG_MIME)) { ev.preventDefault(); ev.stopPropagation(); setDragOver(m.key); } else if (ev.dataTransfer.types.includes(EMP_MIME)) { ev.preventDefault(); } } : undefined}
              onDragLeave={canDnD ? () => setDragOver(null) : undefined}
              onDrop={canDnD ? (ev) => onDrop(ev, m.key) : undefined}
              className={cn(
                'group/row flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors',
                canDnD && m.employeeId && 'cursor-grab active:cursor-grabbing hover:bg-slate-50',
                dragOver === m.key && 'bg-emerald-50 ring-2 ring-emerald-300',
              )}
            >
              {canDnD && <GripVertical className="h-4 w-4 shrink-0 text-slate-300 group-hover/row:text-slate-400" />}
              <span className={cn('h-3 w-3 shrink-0 rounded-full', !m.employeeId && 'border-2 bg-white')} style={m.employeeId ? { backgroundColor: color } : { borderColor: color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {m.employeeId ? (
                    <Tip content={reasons?.[m.key] ? <span><b>Por que esta pessoa?</b><br />{reasons[m.key]}</span> : e?.fullName}>
                      <span className={cn('truncate text-[15px] font-bold text-slate-900', att === 'absent' && 'text-slate-400 line-through')}>{e?.shortName ?? '—'}</span>
                    </Tip>
                  ) : (
                    <span className="truncate text-[15px] font-semibold italic text-slate-500">{m.reservedLabel}</span>
                  )}
                  {memberIssues.length > 0 && (
                    <Tip content={memberIssues.map((i) => i.message).join('\n')}>
                      <AlertTriangle className={cn('h-4 w-4 shrink-0', memberIssues.some((i) => i.severity === 'error') ? 'text-red-500' : 'text-amber-500')} />
                    </Tip>
                  )}
                </div>
                {!m.employeeId && <p className="text-xs text-slate-400">Vaga reservada · pendente</p>}
              </div>
              <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ color, backgroundColor: tint(color, 0.88) }}>
                {m.activityId ? L.skillName(m.activityId) : m.requiredSkillId ? L.skillName(m.requiredSkillId) : 'A definir'}
              </span>

              {mode === 'attendance' && m.employeeId && (
                <div className="flex shrink-0 items-center gap-1">
                  <Tip content="Presente">
                    <Button size="icon" variant={att === 'present' ? 'default' : 'outline'} className="h-8 w-8" aria-label="Presente"
                      onClick={() => run((r) => r.updateAssignment(m.key, { attendance: att === 'present' ? null : 'present' }))}><Check /></Button>
                  </Tip>
                  <Tip content="Ausente">
                    <Button size="icon" variant={att === 'absent' ? 'destructive' : 'outline'} className="h-8 w-8" aria-label="Ausente"
                      onClick={() => run((r) => r.updateAssignment(m.key, { attendance: att === 'absent' ? null : 'absent' }))}><X /></Button>
                  </Tip>
                  {att === 'absent' && !closed && (
                    <Tip content="Registrar substituto">
                      <Button size="icon" variant="soft" className="h-8 w-8" aria-label="Substituir" onClick={() => setPicker({ kind: 'replace', member: m })}><Repeat2 /></Button>
                    </Tip>
                  )}
                </div>
              )}
              {mode === 'view' && att && (
                <Badge className={att === 'present' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}>{att === 'present' ? 'Presente' : 'Ausente'}</Badge>
              )}

              {mode === 'edit' && !closed && (
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 opacity-60 group-hover/row:opacity-100" aria-label="Ações"><MoreHorizontal /></Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuLabel>{e?.shortName ?? m.reservedLabel}</MenuLabel>
                    {m.employeeId ? (
                      <>
                        <MenuItem disabled={!editable} onSelect={() => setSwapFor(m)}><ArrowLeftRight />Trocar com outro sábado…</MenuItem>
                        <MenuItem onSelect={() => setPicker({ kind: 'replace', member: m })}><Repeat2 />Substituir por…</MenuItem>
                        <MenuItem disabled={!editable} onSelect={() => setPicker({ kind: 'activity', member: m })}><Wand2 />Alterar atividade</MenuItem>
                      </>
                    ) : (
                      <MenuItem onSelect={() => setPicker({ kind: 'fill', member: m })}><UserPlus />Preencher vaga</MenuItem>
                    )}
                    <MenuSeparator />
                    <MenuItem disabled={!editable} className="text-red-600 data-[highlighted]:bg-red-50" onSelect={() => run((r) => r.removeAssignment(m.key), 'Removido da escala.')}>
                      <Trash2 className="!text-red-500" />{m.employeeId ? 'Remover da escala' : 'Excluir vaga reservada'}
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </li>
          );
        })}
        {Array.from({ length: emptyRows }).map((_, i) => (
          <li key={'empty' + i} className="flex items-center gap-2.5 px-3 py-2.5">
            {canDnD && <span className="w-4" />}
            <span className="h-3 w-3 rounded-full border-2 border-dashed border-slate-300" />
            {editable && placing && !day.members.some((m) => m.employeeId === placing.employeeId) ? (
              <button className="flex-1 rounded-md border border-emerald-400 bg-emerald-50 py-1 text-left text-sm font-bold text-emerald-800 transition hover:bg-emerald-100"
                onClick={() => placeEmployee(placing.employeeId)}>
                <span className="px-2"><Plus className="mr-1 inline h-3.5 w-3.5" />Colocar {placing.name} aqui</span>
              </button>
            ) : editable ? (
              <button className="flex-1 rounded-md border border-dashed border-slate-200 py-1 text-left text-sm font-medium text-slate-400 transition hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-700"
                onClick={() => setPicker({ kind: 'add' })}>
                <span className="px-2"><Plus className="mr-1 inline h-3.5 w-3.5" />Vaga disponível</span>
              </button>
            ) : (
              <span className="flex-1 border-b border-dashed border-slate-200 text-sm text-slate-300">&nbsp;</span>
            )}
          </li>
        ))}
        {day.members.length === 0 && emptyRows === 0 && (
          <li className="flex items-center gap-2 px-3 py-4 text-sm text-slate-400"><UserRoundX className="h-4 w-4" />Sem equipe</li>
        )}
      </ul>

      {day.workDay?.note && <p className="mx-5 mb-2 rounded-lg bg-petrol-50 px-3 py-1.5 text-xs font-medium text-petrol-700">{day.workDay.note}</p>}

      {/* Indicadores */}
      <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3">
        <ActivityCounts day={day} />
      </div>

      {picker && (
        <PersonPickerDialog
          open
          onOpenChange={(o) => !o && setPicker(null)}
          kind={picker.kind}
          day={day}
          member={picker.member}
          allDays={allDays}
        />
      )}
      {swapFor && <SwapDialog open onOpenChange={(o) => !o && setSwapFor(null)} source={swapFor} sourceDate={day.date} allDays={allDays} />}
      {editDay && <WorkDayDialog open onOpenChange={setEditDay} day={day} />}
      {editExtra && <ExtraDayDialog open onOpenChange={setEditExtra} day={day} />}
    </div>
  );
}
