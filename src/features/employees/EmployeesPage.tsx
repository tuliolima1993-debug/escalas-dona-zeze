import { useMemo, useState } from 'react';
import { CalendarX2, Filter, Pencil, Plus, Search, UserRound, Users } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { fmtFull, fmtShort } from '@/domain/dates';
import { employeeStats } from '@/domain/stats';
import { STATUS_LABEL, type Employee, type EmployeeStatus } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { Badge, EmptyState, PageHeader, TabsContent, TabsList, TabsRoot, TabsTrigger } from '@/components/ui/misc';
import { cn, readableOn } from '@/lib/utils';
import { todayISO, useLookups } from '../schedule/lookups';
import { EmployeeDialog } from './EmployeeDialog';
import { CatalogPanel } from './CatalogPanel';

const STATUS_STYLE: Record<EmployeeStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  vacation: 'bg-sky-100 text-sky-800',
  leave: 'bg-amber-100 text-amber-800',
  inactive: 'bg-slate-200 text-slate-600',
};

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export function EmployeesPage() {
  const { s, year, month, can } = useSnapshot();
  const L = useLookups();
  const [q, setQ] = useState('');
  const [sector, setSector] = useState('');
  const [status, setStatus] = useState<'' | EmployeeStatus | 'current'>('current');
  const [skill, setSkill] = useState('');
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const stats = useMemo(() => new Map(employeeStats(s, year, month).map((x) => [x.employee.id, x])), [s, year, month]);
  const today = todayISO();

  const list = s.employees
    .filter((e) => !q || `${e.fullName} ${e.shortName} ${e.registration ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .filter((e) => !sector || e.sectorId === sector)
    .filter((e) => (status === 'current' ? e.status !== 'inactive' : !status || e.status === status))
    .filter((e) => !skill || e.skillIds.includes(skill))
    .sort((a, b) => a.shortName.localeCompare(b.shortName));

  return (
    <div>
      <PageHeader
        title="Colaboradores"
        description="Cadastro, setores, habilidades e disponibilidade. Setor principal e habilidades são independentes."
        actions={can.admin && <Button onClick={() => setEditing('new')}><Plus />Novo colaborador</Button>}
      />
      <TabsRoot defaultValue="people">
        <TabsList className="mb-5">
          <TabsTrigger value="people">Colaboradores</TabsTrigger>
          <TabsTrigger value="sectors">Setores</TabsTrigger>
          <TabsTrigger value="skills">Habilidades</TabsTrigger>
        </TabsList>
        <TabsContent value="people">
          <div className="mb-5 grid gap-2 rounded-2xl border border-border bg-white p-3 shadow-sm md:grid-cols-[1fr_180px_180px_180px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Pesquisar por nome ou matrícula" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Setor">
              <option value="">Todos os setores</option>
              {s.sectors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
            <Select value={skill} onChange={(e) => setSkill(e.target.value)} aria-label="Habilidade">
              <option value="">Todas as habilidades</option>
              {L.skillsSorted.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Situação">
              <option value="current">Ativos, férias e afastados</option>
              <option value="">Todas as situações</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>

          {list.length === 0 ? (
            <EmptyState icon={<Filter className="h-6 w-6" />} title="Nenhum colaborador encontrado" description="Ajuste a pesquisa ou os filtros." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((e) => {
                const sec = L.sector.get(e.sectorId ?? '');
                const st = stats.get(e.id);
                const upcoming = s.unavailability.filter((u) => u.employeeId === e.id && u.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
                return (
                  <Card key={e.id} className={cn('group flex flex-col p-4 transition hover:shadow-md', e.status === 'inactive' && 'opacity-60')}>
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold" style={{ backgroundColor: sec?.color ?? '#64748b', color: readableOn(sec?.color ?? '#64748b') }}>
                        {initials(e.shortName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-bold">{e.shortName}</p>
                        <p className="truncate text-xs text-muted-foreground">{e.fullName}</p>
                      </div>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', STATUS_STYLE[e.status])}>{STATUS_LABEL[e.status]}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {sec && <Badge className="border border-slate-200 bg-white text-slate-700">{sec.name}</Badge>}
                      {e.skillIds.map((id) => <Badge key={id} color={L.skillColor(id)}>{L.skillName(id)}</Badge>)}
                      {e.skillIds.length === 0 && <Badge className="bg-red-50 text-red-600">Sem habilidades</Badge>}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-center">
                      <div><p className="text-lg font-extrabold">{st?.scheduledMonth ?? 0}</p><p className="text-[11px] text-muted-foreground">no mês</p></div>
                      <div><p className="text-lg font-extrabold">{st?.scheduledYear ?? 0}</p><p className="text-[11px] text-muted-foreground">no ano</p></div>
                      <div><p className="text-lg font-extrabold">{st?.lastWorked ? fmtShort(st.lastWorked) : '—'}</p><p className="text-[11px] text-muted-foreground">último</p></div>
                    </div>
                    {upcoming.length > 0 && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                        <CalendarX2 className="h-3.5 w-3.5" />
                        Indisponível {upcoming[0].startDate === upcoming[0].endDate ? `em ${fmtFull(upcoming[0].startDate)}` : `de ${fmtShort(upcoming[0].startDate)} a ${fmtShort(upcoming[0].endDate)}`}
                        {upcoming.length > 1 && ` (+${upcoming.length - 1})`}
                      </p>
                    )}
                    {can.edit && (
                      <Button variant="ghost" size="sm" className="mt-3 self-end" onClick={() => setEditing(e)}><Pencil />{can.admin ? 'Editar' : 'Disponibilidade'}</Button>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{list.length} de {s.employees.length} colaboradores. Desativar preserva todo o histórico.</p>
        </TabsContent>
        <TabsContent value="sectors"><CatalogPanel kind="sector" /></TabsContent>
        <TabsContent value="skills"><CatalogPanel kind="skill" /></TabsContent>
      </TabsRoot>
      {editing && <EmployeeDialog employee={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {s.employees.length === 0 && <EmptyState icon={<UserRound className="h-6 w-6" />} title="Nenhum colaborador" />}
    </div>
  );
}
