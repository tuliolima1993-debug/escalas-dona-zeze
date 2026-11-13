import { useState } from 'react';
import { AlertOctagon, AlertTriangle, ChevronDown, Info, ShieldCheck } from 'lucide-react';
import type { Issue } from '@/domain/validate';
import { cn } from '@/lib/utils';

const STYLE = {
  error: { box: 'border-red-200 bg-red-50', icon: <AlertOctagon className="h-4 w-4 text-red-600" />, title: 'text-red-800', label: 'Restrições obrigatórias não atendidas' },
  warning: { box: 'border-amber-200 bg-amber-50', icon: <AlertTriangle className="h-4 w-4 text-amber-600" />, title: 'text-amber-900', label: 'Preferências e alertas' },
  info: { box: 'border-sky-200 bg-sky-50', icon: <Info className="h-4 w-4 text-sky-600" />, title: 'text-sky-900', label: 'Informações' },
} as const;

export function IssueList({ issues, compact }: { issues: Issue[]; compact?: boolean }) {
  const groups = (['error', 'warning', 'info'] as const).map((sev) => ({ sev, items: issues.filter((i) => i.severity === sev) })).filter((g) => g.items.length);
  if (!groups.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
        <ShieldCheck className="h-4 w-4" /> Todas as restrições obrigatórias e preferências estão atendidas.
      </div>
    );
  }
  return (
    <div className={cn('grid gap-3', !compact && 'lg:grid-cols-2')}>
      {groups.map((g) => <Group key={g.sev} sev={g.sev} items={g.items} />)}
    </div>
  );
}

function Group({ sev, items }: { sev: 'error' | 'warning' | 'info'; items: Issue[] }) {
  const st = STYLE[sev];
  const [open, setOpen] = useState(sev === 'error' || items.length <= 3);
  return (
    <div className={cn('rounded-xl border px-4 py-3', st.box, sev === 'error' && 'lg:col-span-2')}>
      <button className={cn('flex w-full items-center gap-2 text-left text-sm font-bold', st.title)} onClick={() => setOpen(!open)}>
        {st.icon}{st.label} ({items.length})
        <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {items.map((i, k) => (
            <li key={k} className="text-sm text-slate-700">
              {i.message}
              {i.suggestions?.length ? (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                  {i.suggestions.map((s, j) => <li key={j}>{s}</li>)}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
