import { useEffect, useState } from 'react';
import { ChevronDown, History, RefreshCw } from 'lucide-react';
import { useSnapshot } from '@/data/DataProvider';
import { fmtDateTime } from '@/domain/dates';
import type { AuditEntry } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Badge, EmptyState, PageHeader } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { useLookups } from '../schedule/lookups';

const ENTITY: Record<string, string> = {
  assignments: 'Participação', employees: 'Colaborador', employee_private: 'Dados internos', employee_skills: 'Habilidade do colaborador',
  unavailability: 'Disponibilidade', settings: 'Configurações', activity_requirements: 'Requisito de atividade', skills: 'Habilidade',
  sectors: 'Setor', schedules: 'Escala', monthly_quotas: 'Cota mensal', quotas: 'Cotas do mês', work_days: 'Sábado', workDays: 'Sábado', profiles: 'Usuário',
};
const ACTION: Record<string, [string, string]> = { insert: ['Inclusão', '#047857'], update: ['Alteração', '#155e75'], delete: ['Exclusão', '#dc2626'] };
const HIDDEN = new Set(['updated_at', 'updatedAt', 'created_at', 'createdAt', 'position']);

export function HistoryPage() {
  const { repo, s } = useSnapshot();
  const L = useLookups();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [entity, setEntity] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const load = () => { setItems(null); repo.listAudit(300).then(setItems).catch(() => setItems([])); };
  useEffect(load, [repo, s]);

  const wdDate = new Map(s.workDays.map((w) => [w.id, w.date]));
  const pretty = (k: string, v: unknown): string => {
    if (v == null || v === '') return '—';
    const str = String(v);
    if (/employee_?id/i.test(k)) return L.empName(str);
    if (/(activity|skill|required_skill|requiredSkill)_?id/i.test(k)) return L.skillName(str);
    if (/sector_?id/i.test(k)) return L.sector.get(str)?.name ?? str;
    if (/work_?day_?id/i.test(k)) return wdDate.get(str)?.split('-').reverse().join('/') ?? str.slice(0, 8);
    if (typeof v === 'object') return JSON.stringify(v);
    return str;
  };
  const describe = (e: AuditEntry) => {
    const rec = (e.after ?? e.before) as Record<string, unknown> | null;
    if (!rec) return '';
    const emp = rec.employee_id ?? rec.employeeId;
    const wd = rec.work_day_id ?? rec.workDayId;
    const parts = [];
    if (rec.short_name ?? rec.shortName) parts.push(String(rec.short_name ?? rec.shortName));
    else if (emp) parts.push(L.empName(String(emp)));
    else if (rec.reserved_label ?? rec.reservedLabel) parts.push(String(rec.reserved_label ?? rec.reservedLabel));
    if (wd) parts.push(pretty('work_day_id', wd));
    if (rec.date) parts.push(String(rec.date).split('-').reverse().join('/'));
    if (rec.name && !parts.length) parts.push(String(rec.name));
    return parts.join(' · ');
  };
  const changes = (e: AuditEntry) => {
    const b = (e.before ?? {}) as Record<string, unknown>;
    const a = (e.after ?? {}) as Record<string, unknown>;
    return Array.from(new Set([...Object.keys(b), ...Object.keys(a)]))
      .filter((k) => !HIDDEN.has(k) && k !== 'id' && JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  };

  const entities = Array.from(new Set((items ?? []).map((i) => i.entity)));
  const list = (items ?? []).filter((i) => !entity || i.entity === entity);

  return (
    <div>
      <PageHeader
        title="Histórico de alterações"
        description="Quem alterou, quando, e a versão anterior e atual de cada registro."
        actions={
          <>
            <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-56" aria-label="Filtrar">
              <option value="">Todos os registros</option>
              {entities.map((x) => <option key={x} value={x}>{ENTITY[x] ?? x}</option>)}
            </Select>
            <Button variant="outline" onClick={load}><RefreshCw />Atualizar</Button>
          </>
        }
      />
      {items && list.length === 0 ? (
        <EmptyState icon={<History className="h-6 w-6" />} title="Nenhuma alteração registrada" description="As alterações feitas a partir de agora aparecerão aqui." />
      ) : (
        <Card className="divide-y divide-slate-100">
          {!items && <p className="p-6 text-sm text-muted-foreground">Carregando…</p>}
          {list.map((e) => {
            const [label, color] = ACTION[e.action] ?? [e.action, '#64748b'];
            const ch = changes(e);
            const isOpen = open === e.id;
            return (
              <div key={e.id}>
                <button className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-slate-50" onClick={() => setOpen(isOpen ? null : e.id)}>
                  <span className="w-40 text-xs font-semibold tabular-nums text-slate-500">{fmtDateTime(e.at)}</span>
                  <Badge color={color}>{label}</Badge>
                  <span className="text-sm font-bold">{ENTITY[e.entity] ?? e.entity}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{describe(e)}{e.summary && <span className="text-slate-400"> — {e.summary}</span>}</span>
                  <span className="text-xs font-semibold text-slate-500">{e.userName ?? 'sistema'}</span>
                  <ChevronDown className={cn('h-4 w-4 text-slate-400 transition', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="bg-slate-50/70 px-5 pb-4">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-400"><th className="py-2">Campo</th><th>Versão anterior</th><th>Versão atual</th></tr></thead>
                      <tbody>
                        {ch.map((k) => (
                          <tr key={k} className="border-t border-slate-200">
                            <td className="py-1.5 pr-4 font-mono text-xs text-slate-500">{k}</td>
                            <td className="pr-4 text-red-700">{pretty(k, (e.before as any)?.[k])}</td>
                            <td className="text-emerald-800">{pretty(k, (e.after as any)?.[k])}</td>
                          </tr>
                        ))}
                        {ch.length === 0 && <tr><td colSpan={3} className="py-2 text-xs text-muted-foreground">Sem diferenças de conteúdo.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
