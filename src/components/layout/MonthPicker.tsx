import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useData } from '@/data/DataProvider';
import { monthLabel } from '@/domain/dates';
import { Button } from '@/components/ui/button';

export function MonthPicker() {
  const { year, month, setPeriod } = useData();
  const shift = (d: number) => {
    const t = new Date(year, month - 1 + d, 1);
    setPeriod(t.getFullYear(), t.getMonth() + 1);
  };
  const now = new Date();
  const isCurrent = now.getFullYear() === year && now.getMonth() + 1 === month;
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-white p-1 shadow-sm">
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(-1)} aria-label="Mês anterior"><ChevronLeft /></Button>
      <button className="min-w-[150px] px-2 text-center text-sm font-bold" onClick={() => setPeriod(now.getFullYear(), now.getMonth() + 1)} title="Voltar ao mês atual">
        {monthLabel(year, month)}
        {!isCurrent && <span className="block text-[10px] font-semibold text-emerald-700">ir para o mês atual</span>}
      </button>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(1)} aria-label="Próximo mês"><ChevronRight /></Button>
    </div>
  );
}
