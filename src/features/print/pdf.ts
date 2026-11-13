import { jsPDF } from 'jspdf';
import { tint } from '@/lib/utils';
import { computeLayout, PT_TO_MM, type Layout, type PrintModel } from './layout';
import { pdfMeasure } from './model';

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbStr = (s: string): [number, number, number] => {
  if (s.startsWith('#')) return rgb(s);
  const m = s.match(/\d+/g)!.map(Number);
  return [m[0], m[1], m[2]];
};

export const FOREST = '#064e3b';
export const FOREST_LIGHT = '#ecfdf5';

/** Gera o PDF (vetorial, layout fixo) a partir do mesmo layout da prévia. */
export function renderPdf(model: PrintModel, emptyRowsTo: number): { doc: jsPDF; layout: Layout } {
  const L = computeLayout(model, pdfMeasure, emptyRowsTo);
  const doc = new jsPDF({ unit: 'mm', format: model.paper.toLowerCase(), orientation: 'landscape', compress: true });
  doc.setProperties({ title: `${model.title} ${model.monthLabel}`, creator: 'Dona Zezé Conde | Gestão de Escalas' });
  const s = L.scale;

  // Cabeçalho
  const h = L.header;
  doc.setFillColor(...rgb(FOREST));
  doc.roundedRect(h.x, h.y, h.w, h.h, L.radius, L.radius, 'F');
  doc.setTextColor(167, 243, 208);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(h.orgPt);
  doc.text(model.org, h.x + 8 * s, h.y + h.h * 0.32, { baseline: 'middle', charSpace: 0.6 * s });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(h.titlePt);
  doc.text(model.title, h.x + 8 * s, h.y + h.h * 0.66, { baseline: 'middle' });
  doc.setFontSize(h.monthPt);
  doc.text(model.monthLabel, h.x + h.w - 8 * s, h.y + h.h * 0.38, { baseline: 'middle', align: 'right' });
  doc.setFontSize(h.shiftPt);
  doc.setTextColor(167, 243, 208);
  doc.text(`HORÁRIO: ${model.shiftLabel}`, h.x + h.w - 8 * s, h.y + h.h * 0.75, { baseline: 'middle', align: 'right' });

  for (const c of L.cards) {
    // Moldura
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.4 * s);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(c.x, c.y, c.w, c.h, L.radius, L.radius, 'FD');
    // Faixa da data
    doc.setFillColor(...rgbStr(tint('#047857', 0.9)));
    doc.roundedRect(c.x, c.y, c.w, c.headH, L.radius, L.radius, 'F');
    doc.rect(c.x, c.y + c.headH - L.radius, c.w, L.radius, 'F');
    doc.setDrawColor(...rgb('#047857'));
    doc.setLineWidth(0.8 * s);
    doc.line(c.x, c.y + c.headH, c.x + c.w, c.y + c.headH);

    doc.setTextColor(...rgb('#047857'));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(L.fonts.weekdayPt);
    doc.text(c.day.weekday, c.x + c.pad, c.y + c.headH * 0.3, { baseline: 'middle', charSpace: 0.5 * s });
    doc.setTextColor(...rgb('#022c22'));
    doc.setFontSize(L.fonts.datePt);
    doc.text(c.day.dayLabel, c.x + c.pad, c.y + c.headH * 0.66, { baseline: 'middle' });
    if (c.shiftDiffers) {
      doc.setFontSize(L.fonts.weekdayPt);
      doc.setTextColor(...rgb('#155e75'));
      doc.text(c.day.shift, c.x + c.w - c.pad, c.y + c.headH * 0.3, { baseline: 'middle', align: 'right' });
    }

    // Linhas de colaboradores
    const rowsTop = c.y + c.headH + c.pad * 0.6;
    c.rows.forEach((m, i) => {
      const cy = rowsTop + c.rowH * (i + 0.5);
      if (i > 0) {
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.25 * s);
        doc.line(c.x + c.pad, rowsTop + c.rowH * i, c.x + c.w - c.pad, rowsTop + c.rowH * i);
      }
      if (!m.name) {
        doc.setDrawColor(203, 213, 225);
        doc.setLineDashPattern([1.2 * s, 1.2 * s], 0);
        doc.line(c.x + c.pad + L.dot + 3 * s, cy + (L.fonts.namePt * PT_TO_MM) * 0.35, c.x + c.w - c.pad, cy + (L.fonts.namePt * PT_TO_MM) * 0.35);
        doc.setLineDashPattern([], 0);
        doc.setDrawColor(203, 213, 225);
        doc.circle(c.x + c.pad + L.dot / 2, cy, L.dot / 2, 'S');
        return;
      }
      doc.setFillColor(...rgb(m.color));
      if (m.pending) {
        doc.setDrawColor(...rgb(m.color));
        doc.setLineWidth(0.5 * s);
        doc.circle(c.x + c.pad + L.dot / 2, cy, L.dot / 2, 'S');
      } else {
        doc.circle(c.x + c.pad + L.dot / 2, cy, L.dot / 2, 'F');
      }
      doc.setFont('helvetica', m.pending ? 'normal' : 'bold');
      doc.setFontSize(L.fonts.namePt);
      doc.setTextColor(...(m.pending ? [100, 116, 139] as [number, number, number] : rgb('#0f172a')));
      doc.text(m.name, c.x + c.pad + L.dot + 3 * s, cy, { baseline: 'middle' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(L.fonts.activityPt);
      doc.setTextColor(...rgb(m.color));
      doc.text(m.activity.toUpperCase(), c.x + c.w - c.pad, cy, { baseline: 'middle', align: 'right' });
    });

    // Nota operacional
    if (c.day.note) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(L.fonts.notePt);
      doc.setTextColor(71, 85, 105);
      const noteY = c.y + c.h - c.footH - 3.5 * s;
      doc.text(c.day.note, c.x + c.pad, noteY, { baseline: 'middle', maxWidth: c.w - 2 * c.pad });
    }

    // Indicadores por atividade
    if (c.footH > 0) {
      const fy = c.y + c.h - c.footH;
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3 * s);
      doc.line(c.x, fy, c.x + c.w, fy);
      let x = c.x + c.pad;
      const cy = fy + c.footH / 2;
      for (const k of c.day.counts) {
        doc.setFillColor(...rgb(k.color));
        doc.circle(x + L.dot * 0.4, cy, L.dot * 0.4, 'F');
        x += L.dot * 0.8 + 1.6 * s;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(L.fonts.countPt);
        doc.setTextColor(51, 65, 85);
        const t = `${k.name}: ${k.count}`;
        doc.text(t, x, cy, { baseline: 'middle' });
        x += pdfMeasure(t, L.fonts.countPt, true) + 6 * s;
      }
    }
  }

  if (L.footer) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(L.footer.pt);
    doc.setTextColor(100, 116, 139);
    doc.text(model.footer, L.W / 2, L.footer.y, { align: 'center', baseline: 'middle' });
  }
  return { doc, layout: L };
}
