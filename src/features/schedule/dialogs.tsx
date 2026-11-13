import { useMemo, useState } from 'react';
import { ArrowLeftRight, Search } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { fmtDayMonth, fmtShort } from '@/domain/dates';
import { checkAvailability, hasSkill } from '@/domain/eligibility';
import { defaultActivity } from '@/domain/scheduler';
import { quotasFor, quotaUsage } from '@/domain/stats';
import type { DayMember, DayView } from '@/domain/validate';
import type { WorkDay } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Dot } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { useLookups } from './lookups';

type Kind = 'add' | 'reserve' | 'replace' | 'fill' | 'activity';

const TITLES: Record<Kind, string> = {
  add: 'Adicionar colaborador',
  reserve: 'Reservar vaga para novo colaborador',
  replace: 'Substituir colaborador',
  fill: 'Preencher vaga reservada',
  activity: 'Alterar atividade',
};

export function PersonPickerDialog({
  open, onOpenChange, kind, day, member, allDays,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; kind: Kind; day: DayView; member?: DayMember; allDays: DayView[];
}) {
  const { s, run } = useSnapshot();
  const L = useLookups();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(kind === 'activity' ? member?.employeeId ?? null : null);
  const [activity, setActivity] = useState<string>(member?.activityId ?? '');
  const reservedCount = allDays.flatMap((d) => d.members).filter((m) => !m.employeeId).length;
  const [label, setLabel] = useState(`Novo colaborador ${reservedCount + 1}`);
  const [reqSkill, setReqSkill] = useState('');
  const [saving, setSaving] = useState(false);

  const monthCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of allDays) for (const m of d.members) if (m.employeeId) c.set(m.employeeId, (c.get(m.employeeId) ?? 0) + 1);
    return c;
  }, [allDays]);

  const requiredSkill = member?.requiredSkillId ?? null;
  const y = Number(day.date.slice(0, 4)), mo = Number(day.date.slice(5, 7));
  const quotas = quotasFor(s, y, mo);
  const used = useMemo(() => quotaUsage(s, y, mo), [s, y, mo]);
  const replacingSelf = kind === 'activity';
  const people = useMemo(() => {
    return s.employees
      .filter((e) => e.status !== 'inactive' || day.members.some((m) => m.employeeId === e.id))
      .map((e) => {
        const av = checkAvailability(e, day.date, s.unavailability);
        const inDay = day.members.some((m) => m.employeeId === e.id);
        const lacks = requiredSkill && !hasSkill(e, requiredSkill);
        const quotaOut = !!quotas && day.countsInQuota !== false && !replacingSelf && (used[e.id] ?? 0) >= (quotas[e.id] ?? 0);
        const reason = inDay ? 'já está neste dia' : !av.ok ? av.reason : lacks ? `sem a habilidade ${L.skillName(requiredSkill)}` : quotaOut ? `cota esgotada (${used[e.id] ?? 0}/${quotas![e.id] ?? 0})` : null;
        return { e, reason, count: monthCounts.get(e.id) ?? 0 };
      })
      .filter((p) => !query || p.e.fullName.toLowerCase().includes(query.toLowerCase()) || p.e.shortName.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => Number(!!a.reason) - Number(!!b.reason) || a.count - b.count || a.e.shortName.localeCompare(b.e.shortName));
  }, [s, day, query, monthCounts, requiredSkill, L]);

  const selEmp = selected ? L.emp.get(selected) : undefined;
  const pick = (id: string) => {
    setSelected(id);
    const e = L.emp.get(id)!;
    const preferred = requiredSkill && hasSkill(e, requiredSkill) ? requiredSkill
      : member?.activityId && hasSkill(e, member.activityId) ? member.activityId
      : defaultActivity(e, s.sectors, s.skills);
    setActivity(preferred ?? '');
  };

  const submit = async () => {
    setSaving(true);
    let ok = false;
    if (kind === 'reserve') {
      ok = await run((r) => r.addAssignment(day.date, { employeeId: null, activityId: null, reservedLabel: label.trim() || 'Vaga reservada', requiredSkillId: reqSkill || null }), 'Vaga reservada.');
    } else if (kind === 'add' && selected) {
      ok = await run((r) => r.addAssignment(day.date, { employeeId: selected, activityId: activity || null, reservedLabel: null, requiredSkillId: null }), 'Colaborador adicionado.');
    } else if ((kind === 'replace' || kind === 'fill') && selected && member) {
      ok = await run((r) => r.replaceAssignment(member.key, selected, activity || null), kind === 'fill' ? 'Vaga preenchida.' : 'Substituição registrada.');
    } else if (kind === 'activity' && member) {
      ok = await run((r) => r.updateAssignment(member.key, { activityId: activity || null }), 'Atividade atualizada.');
    }
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  const canSubmit = kind === 'reserve' ? !!label.trim() : kind === 'activity' ? true : !!selected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLES[kind]}</DialogTitle>
          <DialogDescription>
            Sábado, {fmtDayMonth(day.date)}
            {member?.employeeId && kind === 'replace' && <> · no lugar de <b>{L.empName(member.employeeId)}</b> (o registro original fica no histórico como substituído)</>}
            {kind === 'fill' && member && <> · {member.reservedLabel}{requiredSkill && <> — exige <b>{L.skillName(requiredSkill)}</b></>}</>}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {kind === 'reserve' ? (
            <>
              <Field label="Identificação da vaga" hint="Aparece na escala impressa como vaga pendente.">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
              </Field>
              <Field label="Habilidade obrigatória da vaga" hint="Opcional. Ao preencher, apenas pessoas com essa habilidade poderão ocupar a vaga.">
                <Select value={reqSkill} onChange={(e) => setReqSkill(e.target.value)}>
                  <option value="">Setor a definir</option>
                  {L.skillsSorted.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </Select>
              </Field>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Vagas reservadas ocupam lugar no transporte, mas não contam como colaborador confirmado nem como cobertura de atividade obrigatória.</p>
            </>
          ) : kind === 'activity' ? (
            <Field label={`Atividade de ${selEmp?.shortName}`}>
              <Select value={activity} onChange={(e) => setActivity(e.target.value)}>
                {selEmp?.skillIds.map((id) => <option key={id} value={id}>{L.skillName(id)}</option>)}
              </Select>
            </Field>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus placeholder="Buscar colaborador…" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                {people.map(({ e, reason, count }) => (
                  <button
                    key={e.id}
                    disabled={!!reason}
                    onClick={() => pick(e.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                      selected === e.id ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-transparent hover:bg-slate-50',
                      reason && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{e.shortName}</p>
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {L.sector.get(e.sectorId ?? '')?.name ?? 'Sem setor'}
                        {e.skillIds.map((id) => <Dot key={id} color={L.skillColor(id)} className="h-2 w-2" />)}
                      </p>
                    </div>
                    {reason ? <Badge className="bg-slate-100 text-slate-500">{reason}</Badge> : quotas ? <Badge color="#047857">{used[e.id] ?? 0}/{quotas[e.id] ?? 0} da cota</Badge> : <Badge color={count === 0 ? '#047857' : count >= s.settings.maxPerMonth ? '#b45309' : '#155e75'}>{count} no mês</Badge>}
                  </button>
                ))}
              </div>
              {selEmp && (
                <Field label="Atividade atribuída neste sábado">
                  <Select value={activity} onChange={(e) => setActivity(e.target.value)}>
                    {selEmp.skillIds.length === 0 && <option value="">Sem habilidade cadastrada</option>}
                    {selEmp.skillIds.map((id) => <option key={id} value={id}>{L.skillName(id)}</option>)}
                  </Select>
                </Field>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!canSubmit || saving} onClick={submit}>{saving ? 'Salvando…' : 'Confirmar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SwapDialog({ open, onOpenChange, source, sourceDate, allDays }: {
  open: boolean; onOpenChange: (o: boolean) => void; source: DayMember; sourceDate: string; allDays: (DayView & { workDay?: WorkDay })[];
}) {
  const { run } = useSnapshot();
  const L = useLookups();
  const sourceDay = allDays.find((d) => d.date === sourceDate)!;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trocar {L.empName(source.employeeId)} de sábado</DialogTitle>
          <DialogDescription>Escolha com quem trocar. {L.empName(source.employeeId)} ({fmtShort(sourceDate)}) assume o sábado da outra pessoa e vice-versa.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {allDays.filter((d) => d.date !== sourceDate).map((d) => (
            <div key={d.date}>
              <p className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                {fmtDayMonth(d.date)} {d.locked && <Badge>Bloqueado</Badge>}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {d.members.filter((m) => m.employeeId).map((m) => {
                  const conflict = sourceDay.members.some((x) => x.employeeId === m.employeeId) || d.members.some((x) => x.employeeId === source.employeeId);
                  const disabled = d.locked || conflict;
                  return (
                    <button
                      key={m.key}
                      disabled={disabled}
                      onClick={async () => { if (await run((r) => r.swapAssignments(source.key, m.key), 'Troca realizada. Escala revalidada.')) onOpenChange(false); }}
                      className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-left text-sm font-semibold transition hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Dot color={L.skillColor(m.activityId)} />
                      <span className="flex-1 truncate">{L.empName(m.employeeId)}</span>
                      {conflict ? <span className="text-[11px] font-medium text-slate-400">já escalado</span> : <ArrowLeftRight className="h-4 w-4 text-slate-400" />}
                    </button>
                  );
                })}
                {d.members.filter((m) => m.employeeId).length === 0 && <p className="text-sm text-slate-400">Sem colaboradores</p>}
              </div>
            </div>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function WorkDayDialog({ open, onOpenChange, day }: { open: boolean; onOpenChange: (o: boolean) => void; day: DayView & { workDay?: WorkDay } }) {
  const { run } = useSnapshot();
  const [start, setStart] = useState(day.startTime);
  const [end, setEnd] = useState(day.endTime);
  const [note, setNote] = useState(day.workDay?.note ?? '');
  const invalid = end <= start;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Horário de {fmtDayMonth(day.date)}</DialogTitle>
          <DialogDescription>Altere somente se este sábado tiver horário diferente do padrão.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-2 gap-4">
          <Field label="Início"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Encerramento" error={invalid ? 'Deve ser após o início.' : undefined}><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Observação operacional (aparece na impressão)" className="col-span-2" hint="Não use para informações internas.">
            <Textarea maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Ponto de encontro no portão 2" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={invalid} onClick={async () => { if (await run((r) => r.updateWorkDay(day.date, { startTime: start, endTime: end, note: note.trim() || null }), 'Sábado atualizado.')) onOpenChange(false); }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
