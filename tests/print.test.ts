import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildGenerateInput, resultToCommit } from '../src/domain/generate-input';
import { addAssignment, commitMonth } from '../src/domain/mutations';
import { generateSchedule } from '../src/domain/scheduler';
import { seedSnapshot, SKILL } from '../src/domain/seed';
import { PT_TO_MM, type Paper } from '../src/features/print/layout';
import { buildPrintModel, pdfMeasure } from '../src/features/print/model';
import { renderPdf } from '../src/features/print/pdf';

function scheduleFor(year: number, month: number) {
  let s = seedSnapshot();
  s.settings.maxPerMonth = 3;
  const r = generateSchedule(buildGenerateInput(s, year, month));
  s = commitMonth(s, resultToCommit(r, year, month));
  return s;
}

describe('14. impressão A4 e A3 sem conteúdo cortado', () => {
  const cases: [string, number, number, Paper][] = [
    ['4 sábados A4', 2026, 11, 'A4'],
    ['4 sábados A3', 2026, 11, 'A3'],
    ['5 sábados A4', 2026, 8, 'A4'],
    ['5 sábados A3', 2026, 8, 'A3'],
  ];
  for (const [label, y, m, paper] of cases) {
    it(label, () => {
      const s = scheduleFor(y, m);
      const model = buildPrintModel(s, y, m, paper);
      const { doc, layout: L } = renderPdf(model, 4);
      expect(doc.getNumberOfPages()).toBe(1);
      expect(L.cards).toHaveLength(model.days.length);
      const pageW = paper === 'A4' ? 297 : 420;
      expect(Math.round(L.W)).toBe(pageW);
      for (const c of L.cards) {
        // cartão inteiro dentro da área útil (margens respeitadas)
        expect(c.x).toBeGreaterThanOrEqual(L.margin - 0.01);
        expect(c.y + c.h).toBeLessThanOrEqual(L.H - L.margin + 0.01);
        expect(c.x + c.w).toBeLessThanOrEqual(L.W - L.margin + 0.01);
        // linhas cabem no cartão
        const rowsBottom = c.y + c.headH + c.pad * 0.6 + c.rowH * c.rows.length;
        expect(rowsBottom).toBeLessThanOrEqual(c.y + c.h - c.footH + 0.01);
        expect(L.fonts.namePt * PT_TO_MM).toBeLessThan(c.rowH);
        // nome + atividade cabem na largura
        for (const r of c.rows.filter((x) => x.name)) {
          const need = L.dot + 3 * L.scale + pdfMeasure(r.name, L.fonts.namePt, true) + 4 * L.scale + pdfMeasure(r.activity.toUpperCase(), L.fonts.activityPt, true);
          expect(need).toBeLessThanOrEqual(c.w - 2 * c.pad + 0.01);
        }
        expect(pdfMeasure(c.day.dayLabel, L.fonts.datePt, true)).toBeLessThanOrEqual(c.w - 2 * c.pad);
      }
      // legível a distância
      expect(L.fonts.namePt).toBeGreaterThanOrEqual(paper === 'A4' ? 14 : 19.5);
      // cartões não se sobrepõem
      for (let i = 0; i < L.cards.length; i++)
        for (let j = i + 1; j < L.cards.length; j++) {
          const a = L.cards[i], b = L.cards[j];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
      mkdirSync('test-output', { recursive: true });
      writeFileSync(`test-output/escala-${y}-${m}-${paper}.pdf`, Buffer.from(doc.output('arraybuffer')));
    });
  }

  it('nomes completos longos reduzem a fonte, mas não são cortados', () => {
    const s = scheduleFor(2026, 8);
    s.employees.forEach((e) => (e.shortName = e.fullName)); // pior caso
    const model = buildPrintModel(s, 2026, 8, 'A4');
    const { layout: L } = renderPdf(model, 4);
    for (const c of L.cards)
      for (const r of c.rows.filter((x) => x.name))
        expect(pdfMeasure(r.name, L.fonts.namePt, true) + pdfMeasure(r.activity.toUpperCase(), L.fonts.activityPt, true)).toBeLessThan(c.w - 2 * c.pad);
  });

  it('não inclui observações internas e mostra vagas pendentes', () => {
    let s = scheduleFor(2026, 11);
    s.employees[0].adminNotes = 'SEGREDO INTERNO';
    s.employees[0].restrictions = 'RESTRICAO INTERNA';
    s = { ...s, settings: { ...s.settings, maxPerDay: 5 } };
    s = addAssignment(s, '2026-11-07', { employeeId: null, activityId: null, reservedLabel: 'Novo colaborador 1', requiredSkillId: SKILL.clonagem });
    const model = buildPrintModel(s, 2026, 11, 'A4');
    const json = JSON.stringify(model);
    expect(json).not.toContain('SEGREDO');
    expect(json).not.toContain('RESTRICAO');
    expect(model.days[0].members.some((m) => m.pending && m.name === 'Novo colaborador 1')).toBe(true);
    const { doc } = renderPdf(model, 4);
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
