import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, FileSpreadsheet, Repeat2 } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { fmtFull, fmtShort, MONTHS_PT, monthLabel } from '@/domain/dates';
import { employeeStats } from '@/domain/stats';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, PageHeader } from '@/components/ui/misc';
import { MonthPicker } from '@/components/layout/MonthPicker';
import { cn } from '@/lib/utils';
import { useLookups } from '../schedule/lookups';
import { downloadCsv, downloadXlsx } from './export';

// Cores validadas (presente / previsto / ausente) — identidade também por legenda e tabela
const C = { present: '#059669', pending: '#94a3b8', absent: '#dc2626' };

export function ReportsPage() {
  const { s, year, month } = useSnapshot();
  const L = useLookups();
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const stats = useMemo(() => employeeStats(s, year, month), [s, year, month]);
  const rows = stats
    .filter((x) => scope === 'all' || x.employee.status !== 'inactive' || x.scheduledYear > 0)
    .sort((a, b) => b.scheduledYear - a.scheduledYear || a.employee.shortName.localeCompare(b.employee.shortName));
  const monthsWithData = Array.from({ length: 12 }, (_, i) => i).filter((i) => rows.some((r) => r.byMonth[i] > 0) || i + 1 === month);

  const chart = rows.map((r) => ({
    name: r.employee.shortName,
    Presente: r.presentYear,
    Ausente: r.absentYear,
    'Previsto / sem registro': r.scheduledYear - r.presentYear - r.absentYear,
  }));

  const yearTotals = rows.map((r) => r.scheduledYear);
  const spread = yearTotals.length ? Math.max(...yearTotals) - Math.min(...yearTotals) : 0;
  const totalScheduled = rows.reduce((n, r) => n + r.scheduledYear, 0);
  const totalPresent = rows.reduce((n, r) => n + r.presentYear, 0);
  const totalAbsent = rows.reduce((n, r) => n + r.absentYear, 0);
  const hours = rows.reduce((n, r) => n + r.hoursWorkedYear, 0);

  const substitutions = useMemo(() => {
    const wd = new Map(s.workDays.map((w) => [w.id, w]));
    return s.assignments
      .filter((a) => a.status === 'replaced' && wd.get(a.workDayId)?.date.startsWith(`${year}-`))
      .map((a) => ({ a, date: wd.get(a.workDayId)!.date, by: s.assignments.find((x) => x.id === a.replacedById) }))
      .sort((x, y) => y.date.localeCompare(x.date));
  }, [s, year]);

  const exportRows = () => {
    const header = ['Colaborador', 'Nome completo', 'Setor', ...monthsWithData.map((i) => MONTHS_PT[i]), `Escalado ${monthLabel(year, month)}`, 'Total no ano', 'Presente', 'Ausente', 'Substituído', 'Horas trabalhadas', 'Máx. sábados consecutivos', 'Último sábado'];
    const body = rows.map((r) => [
      r.employee.shortName, r.employee.fullName, L.sector.get(r.employee.sectorId ?? '')?.name ?? '',
      ...monthsWithData.map((i) => r.byMonth[i]), r.scheduledMonth, r.scheduledYear, r.presentYear, r.absentYear, r.replacedYear,
      r.hoursWorkedYear, r.maxConsecutive, r.lastWorked ? fmtFull(r.lastWorked) : '',
    ]);
    return { header, body };
  };

  return (
    <div>
      <PageHeader
        title="Frequência e distribuição"
        description={`Calculado a partir dos registros reais de ${year}. Escalado = designado · Presente = compareceu · Ausente = faltou · Substituído = removido por troca.`}
        actions={
          <>
            <MonthPicker />
            <Button variant="outline" onClick={() => { const { header, body } = exportRows(); downloadCsv(`frequencia-${year}.csv`, header, body); }}><Download />CSV</Button>
            <Button variant="outline" onClick={() => { const { header, body } = exportRows(); downloadXlsx(`frequencia-${year}.xlsx`, header, body); }}><FileSpreadsheet />Excel</Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Escalações no ano', totalScheduled, ''],
          ['Presenças registradas', totalPresent, totalScheduled ? `${Math.round((totalPresent / totalScheduled) * 100)}% do escalado` : ''],
          ['Ausências', totalAbsent, ''],
          ['Horas trabalhadas', hours.toLocaleString('pt-BR'), 'apenas presenças registradas'],
          ['Diferença no ano', spread, spread <= 2 ? 'distribuição equilibrada' : 'revise a distribuição'],
        ].map(([label, value, sub]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-[13px] font-semibold text-muted-foreground">{label}</p>
            <p className="mt-1 text-[26px] font-extrabold tracking-tight">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Participações por colaborador em {year}</CardTitle>
          <CardDescription>Barras mais longas indicam quem mais trabalhou aos sábados; use para identificar desequilíbrios.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap={6}>
                <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12, fill: '#334155', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
                <Bar isAnimationActive={false} dataKey="Presente" stackId="a" fill={C.present} stroke="#fff" strokeWidth={2} />
                <Bar isAnimationActive={false} dataKey="Previsto / sem registro" stackId="a" fill={C.pending} stroke="#fff" strokeWidth={2} />
                <Bar isAnimationActive={false} dataKey="Ausente" stackId="a" fill={C.absent} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Comparativo mensal</CardTitle>
            <CardDescription>Sábados escalados por mês · destaque no mês selecionado</CardDescription>
          </div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            <button className={cn('rounded-md px-2 py-1', scope === 'current' && 'bg-white shadow-sm')} onClick={() => setScope('current')}>Atuais</button>
            <button className={cn('rounded-md px-2 py-1', scope === 'all' && 'bg-white shadow-sm')} onClick={() => setScope('all')}>Todos</button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Colaborador</th>
                {monthsWithData.map((i) => <th key={i} className={cn('px-3 py-3 text-right capitalize', i + 1 === month && 'bg-emerald-50 text-emerald-800')}>{MONTHS_PT[i].slice(0, 3)}</th>)}
                <th className="px-3 py-3 text-right">Total</th>
                <th className="px-3 py-3 text-right">Pres.</th>
                <th className="px-3 py-3 text-right">Aus.</th>
                <th className="px-3 py-3 text-right">Subst.</th>
                <th className="px-3 py-3 text-right">Horas</th>
                <th className="px-3 py-3 text-right">Consec.</th>
                <th className="px-5 py-3 text-right">Último</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.employee.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-2.5">
                    <p className="font-semibold">{r.employee.shortName}</p>
                    <p className="text-xs text-muted-foreground">{L.sector.get(r.employee.sectorId ?? '')?.name}</p>
                  </td>
                  {monthsWithData.map((i) => <td key={i} className={cn('px-3 py-2.5 text-right tabular-nums', i + 1 === month && 'bg-emerald-50/60 font-bold', r.byMonth[i] === 0 && 'text-slate-300')}>{r.byMonth[i]}</td>)}
                  <td className="px-3 py-2.5 text-right font-extrabold tabular-nums">{r.scheduledYear}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{r.presentYear}</td>
                  <td className={cn('px-3 py-2.5 text-right tabular-nums', r.absentYear ? 'font-bold text-red-600' : 'text-slate-300')}>{r.absentYear}</td>
                  <td className={cn('px-3 py-2.5 text-right tabular-nums', !r.replacedYear && 'text-slate-300')}>{r.replacedYear}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.hoursWorkedYear}h</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.maxConsecutive > 1 ? <Badge className="bg-amber-100 text-amber-800">{r.maxConsecutive}</Badge> : r.maxConsecutive}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">{r.lastWorked ? fmtShort(r.lastWorked) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Repeat2 className="h-4 w-4" />Histórico de substituições em {year}</CardTitle>
        </CardHeader>
        <CardContent>
          {substitutions.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma substituição registrada.</p> : (
            <ul className="divide-y divide-slate-100">
              {substitutions.map(({ a, date, by }) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="w-24 font-semibold tabular-nums text-slate-500">{fmtFull(date)}</span>
                  <span className="font-semibold line-through decoration-red-400">{L.empName(a.employeeId)}</span>
                  {a.attendance === 'absent' && <Badge className="bg-red-100 text-red-700">ausente</Badge>}
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-emerald-800">{by ? L.empName(by.employeeId) : '—'}</span>
                  {by?.activityId && <Badge color={L.skillColor(by.activityId)}>{L.skillName(by.activityId)}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
