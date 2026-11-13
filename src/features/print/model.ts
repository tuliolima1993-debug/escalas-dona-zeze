import { jsPDF } from 'jspdf';
import { fmtDayMonth, fmtShift, monthLabel } from '@/domain/dates';
import { dayViewsFor } from '@/domain/stats';
import { dayIdeal } from '@/domain/validate';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { fromISO } from '@/domain/dates';
import type { Snapshot } from '@/domain/types';
import type { Measure, Paper, PrintModel } from './layout';

/** Monta o conteúdo do quadro de avisos — somente informações operacionais (sem observações internas). */
export function buildPrintModel(s: Snapshot, year: number, month: number, paper: Paper): PrintModel {
  const skills = [...s.skills].filter((k) => k.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const skillById = new Map(s.skills.map((k) => [k.id, k]));
  const emp = new Map(s.employees.map((e) => [e.id, e]));
  const days = dayViewsFor(s, year, month);
  return {
    org: s.settings.orgName.toUpperCase(),
    title: 'ESCALA DE TRABALHO — SÁBADOS',
    monthLabel: monthLabel(year, month).replace(' de ', ' ').toUpperCase(),
    shiftLabel: fmtShift(s.settings.startTime, s.settings.endTime),
    paper,
    showCounts: s.settings.print.showActivityCounts,
    footer: s.settings.print.footerText ?? '',
    days: days.map((d) => {
      const counts = new Map<string, number>();
      for (const m of d.members) if (m.employeeId && m.activityId) counts.set(m.activityId, (counts.get(m.activityId) ?? 0) + 1);
      return {
        date: d.date,
        weekday: d.kind === 'extra'
          ? `${format(fromISO(d.date), 'EEEE', { locale: ptBR }).replace('-feira', '').toUpperCase()} · EXTRA`
          : 'SÁBADO',
        minRows: s.settings.print.emptySlotsToIdeal ? dayIdeal(d, s.settings) : 0,
        dayLabel: fmtDayMonth(d.date).toUpperCase(),
        shift: fmtShift(d.startTime, d.endTime),
        note: [d.kind === 'extra' ? d.label : null, d.workDay?.note].filter(Boolean).join(' · ') || null,
        members: d.members.map((m) => {
          const sk = skillById.get(m.activityId ?? m.requiredSkillId ?? '');
          if (!m.employeeId) {
            return { name: m.reservedLabel ?? 'Vaga reservada', activity: sk?.name ?? 'A definir', color: sk?.color ?? '#94a3b8', pending: true };
          }
          return { name: emp.get(m.employeeId)?.shortName ?? '—', activity: sk?.name ?? '', color: sk?.color ?? '#64748b', pending: false };
        }),
        counts: skills.map((k) => ({ name: k.name, color: k.color, count: counts.get(k.id) ?? 0 })),
      };
    }),
  };
}

let measurer: jsPDF | null = null;
/** Medição de texto com as métricas da fonte Helvetica do PDF (Arial no navegador tem as mesmas larguras). */
export const pdfMeasure: Measure = (text, pt, bold) => {
  measurer ??= new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  measurer.setFont('helvetica', bold ? 'bold' : 'normal');
  measurer.setFontSize(pt);
  return measurer.getTextWidth(text);
};
