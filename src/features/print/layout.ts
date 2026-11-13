/**
 * Layout de impressão compartilhado: a prévia em HTML, a impressão do navegador e o PDF
 * usam exatamente as mesmas coordenadas (em milímetros) e tamanhos de fonte (em pontos).
 * Assim a impressão reproduz fielmente a prévia e nada é cortado.
 */
export const PT_TO_MM = 0.352778;

export type Paper = 'A4' | 'A3';

export interface PrintMember {
  name: string; // vazio = linha em branco para vaga não preenchida
  activity: string;
  color: string;
  pending: boolean; // vaga reservada
}

export interface PrintDay {
  date: string;
  weekday: string; // "SÁBADO"
  dayLabel: string; // "14 DE NOVEMBRO"
  shift: string; // "06h às 09h"
  members: PrintMember[];
  counts: { name: string; color: string; count: number }[];
  note: string | null;
  /** Linhas mínimas (vagas em branco até a equipe ideal do dia). */
  minRows?: number;
}

export interface PrintModel {
  org: string;
  title: string;
  monthLabel: string;
  shiftLabel: string;
  paper: Paper;
  days: PrintDay[];
  showCounts: boolean;
  footer: string;
}

/** Mede a largura de um texto em mm. */
export type Measure = (text: string, fontPt: number, bold: boolean) => number;

export interface CardBox {
  day: PrintDay;
  x: number; y: number; w: number; h: number;
  pad: number;
  headH: number;
  footH: number;
  rowH: number;
  rows: PrintMember[];
  shiftDiffers: boolean;
}

export interface Layout {
  W: number; H: number; margin: number; scale: number;
  header: { x: number; y: number; w: number; h: number; orgPt: number; titlePt: number; monthPt: number; shiftPt: number };
  cards: CardBox[];
  fonts: { weekdayPt: number; datePt: number; namePt: number; activityPt: number; countPt: number; notePt: number };
  footer: { y: number; pt: number } | null;
  dot: number;
  radius: number;
}

export function gridFor(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n === 3) return { cols: 3, rows: 1 };
  if (n === 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: Math.ceil(n / 3) };
}

function fit(text: string, maxWidth: number, startPt: number, minPt: number, bold: boolean, measure: Measure) {
  let pt = startPt;
  while (pt > minPt && measure(text, pt, bold) > maxWidth) pt -= 0.25;
  return pt;
}

export function computeLayout(model: PrintModel, measure: Measure, emptyRowsTo: number): Layout {
  const s = model.paper === 'A3' ? Math.SQRT2 : 1;
  const W = 297 * s, H = 210 * s;
  const margin = 10 * s;
  const gap = 5 * s;
  const headerH = 27 * s;
  const footer = model.footer.trim() ? { y: H - margin - 2 * s, pt: 9 * s } : null;

  const header = {
    x: margin, y: margin, w: W - 2 * margin, h: headerH,
    orgPt: 13 * s, titlePt: 24 * s, monthPt: 30 * s, shiftPt: 15 * s,
  };
  // Garante que título e mês caibam lado a lado
  const leftMax = header.w * 0.62 - 10 * s;
  header.titlePt = fit(model.title, leftMax, header.titlePt, 12, true, measure);
  header.orgPt = fit(model.org, leftMax, header.orgPt, 8, true, measure);
  header.monthPt = fit(model.monthLabel, header.w * 0.36 - 8 * s, header.monthPt, 14, true, measure);

  const top = margin + headerH + 6 * s;
  const bottom = H - margin - (footer ? 6 * s : 0);
  const gridW = W - 2 * margin;
  const gridH = bottom - top;
  const n = Math.max(1, model.days.length);
  const { cols, rows } = gridFor(n);
  const cardW = (gridW - gap * (cols - 1)) / cols;
  const cardH = (gridH - gap * (rows - 1)) / rows;

  const pad = 5 * s;
  const headH = Math.min(22 * s, cardH * 0.26);
  const footH = model.showCounts ? Math.min(11 * s, cardH * 0.14) : 0;
  const hasNotes = model.days.some((d) => d.note);
  const noteH = hasNotes ? 6 * s : 0;

  const rowsPerCard = Math.max(1, ...model.days.map((d) => Math.max(d.minRows ?? emptyRowsTo, d.members.length)));
  const rowsArea = cardH - headH - footH - noteH - pad * 1.2;
  const rowH = rowsArea / rowsPerCard;

  // Fonte dos nomes: limitada pela altura da linha e pela largura disponível (mesma para todos os cartões)
  const dot = Math.min(4.2 * s, rowH * 0.35);
  const innerW = cardW - 2 * pad;
  const longestName = model.days.flatMap((d) => d.members.map((m) => m.name)).reduce((a, b) => (b.length > a.length ? b : a), 'Colaborador');
  const longestAct = model.days.flatMap((d) => d.members.map((m) => m.activity)).reduce((a, b) => (b.length > a.length ? b : a), '');
  let namePt = Math.min((rowH * 0.6) / PT_TO_MM, 26 * s);
  const minPt = 7;
  while (namePt > minPt) {
    const actPt = Math.max(6, namePt * 0.6);
    const need = dot + 3 * s + measure(longestName, namePt, true) + 4 * s + measure(longestAct.toUpperCase(), actPt, true);
    if (need <= innerW) break;
    namePt -= 0.25;
  }
  const activityPt = Math.max(6, namePt * 0.6);

  const datePt = Math.min((headH * 0.42) / PT_TO_MM, 22 * s);
  const longestDate = model.days.map((d) => d.dayLabel).reduce((a, b) => (b.length > a.length ? b : a), '');
  const fittedDate = fit(longestDate, innerW * 0.68, datePt, 8, true, measure);
  const weekdayPt = Math.min(fittedDate * 0.5, 11 * s);

  const countsText = (d: PrintDay) => d.counts.map((c) => `${c.name}: ${c.count}`).join('      ');
  const longestCounts = model.days.map(countsText).reduce((a, b) => (b.length > a.length ? b : a), '');
  const countPt = model.showCounts
    ? fit(longestCounts, innerW - model.days[0]?.counts.length * (dot + 2 * s), Math.min((footH * 0.42) / PT_TO_MM, 12 * s), 6, true, measure)
    : 0;

  const cards: CardBox[] = model.days.map((day, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = Math.min(cols, n - r * cols);
    const offset = ((cols - inRow) * (cardW + gap)) / 2; // centraliza a última linha incompleta
    const filled = [...day.members];
    while (filled.length < Math.max(day.minRows ?? emptyRowsTo, day.members.length)) filled.push({ name: '', activity: '', color: '#cbd5e1', pending: false });
    return {
      day, x: margin + offset + c * (cardW + gap), y: top + r * (cardH + gap), w: cardW, h: cardH,
      pad, headH, footH, rowH, rows: filled,
      shiftDiffers: day.shift !== model.shiftLabel,
    };
  });

  return {
    W, H, margin, scale: s, header, cards,
    fonts: { weekdayPt, datePt: fittedDate, namePt, activityPt, countPt, notePt: 8.5 * s },
    footer, dot, radius: 3.5 * s,
  };
}
