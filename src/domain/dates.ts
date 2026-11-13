import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getDay,
  parseISO,
  startOfMonth,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { ISODate } from './types';

export const toISO = (d: Date): ISODate => format(d, 'yyyy-MM-dd');
export const fromISO = (s: ISODate): Date => parseISO(s);

/** Todos os sábados do mês (month = 1..12). */
export function saturdaysOfMonth(year: number, month: number): ISODate[] {
  const first = startOfMonth(new Date(year, month - 1, 1));
  const last = endOfMonth(first);
  const offset = (6 - getDay(first) + 7) % 7;
  const result: ISODate[] = [];
  for (let d = addDays(first, offset); d <= last; d = addDays(d, 7)) result.push(toISO(d));
  return result;
}

export const weeksBetween = (a: ISODate, b: ISODate) =>
  Math.round(Math.abs(differenceInCalendarDays(fromISO(b), fromISO(a))) / 7);

export const monthKey = (iso: ISODate) => iso.slice(0, 7); // "2026-11"
export const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;

export const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export const monthLabel = (year: number, month: number) =>
  `${MONTHS_PT[month - 1].replace(/^./, (c) => c.toUpperCase())} de ${year}`;

export const fmtDayMonth = (iso: ISODate) => format(fromISO(iso), "dd 'de' MMMM", { locale: ptBR });
export const fmtShort = (iso: ISODate) => format(fromISO(iso), 'dd/MM');
export const fmtFull = (iso: ISODate) => format(fromISO(iso), 'dd/MM/yyyy');
export const fmtDateTime = (iso: string) => format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

/** "06:00" -> "06h"; "06:30" -> "06h30" */
export const fmtHour = (t: string) => {
  const [h, m] = t.split(':');
  return m && m !== '00' ? `${h}h${m}` : `${h}h`;
};
export const fmtShift = (start: string, end: string) => `${fmtHour(start)} às ${fmtHour(end)}`;

export function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
}

export const inRange = (d: ISODate, start: ISODate, end: ISODate) => d >= start && d <= end;
