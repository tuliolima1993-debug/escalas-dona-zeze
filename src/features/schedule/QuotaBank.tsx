import { useMemo, useState } from 'react';
import { Hand, Lock, Minus, Plus, RefreshCw, Sparkles, Users, X } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { checkAvailability } from '@/domain/eligibility';
import { suggestQuotas } from '@/domain/generate-input';
import { quotaUsage, quotasFor } from '@/domain/stats';
import { dayIdeal, type DayView } from '@/domain/validate';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dot, Tip } from '@/components/ui/misc';
import { cn, readableOn } from '@/lib/utils';
import { EMP_MIME } from './DayCard';
import { useLookups } from './lookups';

export interface Placing { employeeId: string; name: string }

/**
 * Banco de participações do mês: cada pessoa tem uma cota (ex.: Ediane 2).
 * Arraste o cartão para uma data — ou toque nele e depois em "Colocar aqui".
 * Quando a cota acaba, o cartão fica bloqueado; daí em diante só é possível mudar de data.
 */
export function QuotaBank({ year, month, days, placing, setPlacing, readOnly }: {
  year: number; month: number; days: DayView[]; placing: Placing | null; setPlacing: (p: Placing | null) => void; readOnly?: boolean;
}) {
  const { s, run } = useSnapshot();
  const L = useLookups();
  const [busy, setBusy] = useState(false);
  const quotas = quotasFor(s, year, month);
  const used = useMemo(() => quotaUsage(s, year, month), [s, year, month]);
  const totalSlots = days.filter((d) => d.countsInQuota !== false).reduce((n, d) => n + dayIdeal(d, s.settings), 0);

  const enable = async () => {
    setBusy(true);
    const { quotas: sug } = suggestQuotas(s, year, month);
    // nunca abaixo do que já está na escala
    for (const [id, n] of Object.entries(used)) sug[id] = Math.max(sug[id] ?? 0, n);
    await run((r) => r.setQuotas(year, month, sug, true), 'Banco de participações criado. Ajuste as cotas e arraste os nomes para as datas.');
    setBusy(false);
  };

  if (!quotas) {
    return (
      <Card className="p-5">
        <p className="flex items-center gap-2 text-base font-bold"><Users className="h-4 w-4 text-emerald-700" />Banco de participações</p>
        <p className="mt-2 text-sm text-muted-foreground">
          O sistema calcula quantas vezes cada pessoa vem no mês ({totalSlots} vagas), de forma equilibrada e considerando o histórico.
          Você ajusta as cotas e arrasta os nomes para as datas.
        </p>
        {!readOnly && <Button className="mt-4 w-full" disabled={busy} onClick={enable}><Sparkles />Calcular cotas do mês</Button>}
      </Card>
    );
  }

  const people = s.employees
    .filter((e) => e.status === 'active' || (quotas[e.id] ?? 0) > 0 || (used[e.id] ?? 0) > 0)
    .map((e) => ({ e, q: quotas[e.id] ?? 0, u: used[e.id] ?? 0 }))
    .sort((a, b) => Number(a.q - a.u <= 0) - Number(b.q - b.u <= 0) || a.e.shortName.localeCompare(b.e.shortName));
  const totalQuota = people.reduce((n, p) => n + p.q, 0);
  const totalUsed = people.reduce((n, p) => n + p.u, 0);
  const diff = totalQuota - totalSlots;

  const setOne = (id: string, q: number) => run((r) => r.setQuotas(year, month, { [id]: q }, true));
  const recalc = async () => {
    const { quotas: sug } = suggestQuotas(s, year, month);
    for (const [id, n] of Object.entries(used)) sug[id] = Math.max(sug[id] ?? 0, n);
    await run((r) => r.setQuotas(year, month, sug, true), 'Cotas recalculadas.');
  };

  return (
    <Card className="flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden lg:sticky lg:top-20">
      <div className="border-b border-border p-4">
        <p className="flex items-center gap-2 text-base font-bold"><Users className="h-4 w-4 text-emerald-700" />Banco de participações</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-2">
            <p className={cn('text-xl font-extrabold', diff !== 0 && 'text-amber-700')}>{totalQuota}<span className="text-sm text-slate-400">/{totalSlots}</span></p>
            <p className="text-[11px] text-muted-foreground">cotas × vagas</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2">
            <p className="text-xl font-extrabold">{totalUsed}<span className="text-sm text-slate-400">/{totalQuota}</span></p>
            <p className="text-[11px] text-muted-foreground">já colocadas</p>
          </div>
        </div>
        {diff !== 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
            {diff > 0 ? `As cotas passam ${diff} do total de vagas: alguém ficará com participação sobrando.` : `Faltam ${-diff} participação(ões) para cobrir todas as vagas. Aumente alguma cota.`}
          </p>
        )}
        {placing ? (
          <p className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">
            <Hand className="h-4 w-4" />Toque em “Colocar {placing.name} aqui” no dia desejado
            <button className="ml-auto" aria-label="Cancelar" onClick={() => setPlacing(null)}><X className="h-4 w-4" /></button>
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Arraste um nome para a data — ou toque no nome e depois no dia.</p>
        )}
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5 scrollbar-thin">
        {people.map(({ e, q, u }) => {
          const left = q - u;
          const sector = L.sector.get(e.sectorId ?? '');
          const blocked = left <= 0;
          const unavailableDays = days.filter((d) => !checkAvailability(e, d.date, s.unavailability).ok).length;
          const selected = placing?.employeeId === e.id;
          return (
            <div
              key={e.id}
              draggable={!readOnly && !blocked}
              onDragStart={(ev) => { ev.dataTransfer.setData(EMP_MIME, e.id); ev.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => !readOnly && !blocked && setPlacing(selected ? null : { employeeId: e.id, name: e.shortName })}
              className={cn(
                'group rounded-xl border p-2.5 transition',
                blocked ? 'border-slate-200 bg-slate-50' : 'cursor-grab border-border bg-white hover:border-emerald-300 hover:shadow-sm active:cursor-grabbing',
                selected && 'border-emerald-500 ring-2 ring-emerald-500',
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-extrabold" style={{ backgroundColor: sector?.color ?? '#64748b', color: readableOn(sector?.color ?? '#64748b'), opacity: blocked ? 0.45 : 1 }}>
                  {e.shortName.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm font-bold', blocked && 'text-slate-400')}>{e.shortName}</p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {sector?.name}
                    {e.skillIds.map((id) => <Tip key={id} content={L.skillName(id)}><span><Dot color={L.skillColor(id)} className="h-2 w-2" /></span></Tip>)}
                    {unavailableDays > 0 && <span className="text-amber-700">· indisp. {unavailableDays}d</span>}
                  </p>
                </div>
                {blocked ? (
                  <Tip content={q === 0 ? 'Sem cota neste mês' : 'Cota usada. Para mudar a data, arraste o nome dentro do quadro.'}>
                    <span className="flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600"><Lock className="h-3 w-3" />{u}/{q}</span>
                  </Tip>
                ) : (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800">{u}/{q}</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex flex-1 gap-1">
                  {Array.from({ length: Math.max(q, u) }).map((_, i) => (
                    <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < u ? (i < q ? 'bg-emerald-500' : 'bg-red-500') : 'bg-slate-200')} />
                  ))}
                  {q === 0 && u === 0 && <span className="text-[11px] text-slate-400">sem participações</span>}
                </div>
                {!readOnly && (
                  <div className="flex items-center gap-0.5" onClick={(ev) => ev.stopPropagation()}>
                    <Tip content={q <= u ? 'Não dá para reduzir abaixo do já colocado. Remova ou mova antes.' : 'Diminuir cota'}>
                      <span><Button variant="ghost" size="icon" className="h-6 w-6" disabled={q <= u || q <= 0} aria-label="Diminuir" onClick={() => setOne(e.id, q - 1)}><Minus /></Button></span>
                    </Tip>
                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={q >= 10 || e.status !== 'active'} aria-label="Aumentar" onClick={() => setOne(e.id, q + 1)}><Plus /></Button>
                  </div>
                )}
              </div>
              {!blocked && <p className="mt-1 text-[11px] font-semibold text-emerald-700">Disponíveis: {left}</p>}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <div className="flex gap-2 border-t border-border p-2.5">
          <Button variant="ghost" size="sm" className="flex-1" onClick={recalc}><RefreshCw />Recalcular</Button>
          <Button variant="ghost" size="sm" className="flex-1 text-slate-500" onClick={() => run((r) => r.setQuotas(year, month, {}, false), 'Banco de cotas desativado: escala livre.')}>Desativar banco</Button>
        </div>
      )}
    </Card>
  );
}
