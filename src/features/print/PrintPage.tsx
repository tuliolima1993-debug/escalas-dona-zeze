import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Expand, FileDown, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useSnapshot } from '@/data/DataProvider';
import { monthLabel } from '@/domain/dates';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge, EmptyState, PageHeader, TabsList, TabsRoot, TabsTrigger } from '@/components/ui/misc';
import { MonthPicker } from '@/components/layout/MonthPicker';
import { tint } from '@/lib/utils';
import { computeLayout, PT_TO_MM, type Layout, type Paper, type PrintModel } from './layout';
import { buildPrintModel, pdfMeasure } from './model';
import { FOREST, renderPdf } from './pdf';
import { useMonthView } from '../schedule/lookups';
import { hasErrors } from '@/domain/validate';
import { CalendarX2 } from 'lucide-react';

const FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';
const mm = (v: number) => `${v}mm`;
const pt = (v: number) => `${v}pt`;

/** Página HTML desenhada com as mesmas coordenadas do PDF. */
export function PrintSheet({ model, layout: L }: { model: PrintModel; layout: Layout }) {
  const s = L.scale;
  const h = L.header;
  const text = (style: React.CSSProperties): React.CSSProperties => ({ position: 'absolute', whiteSpace: 'nowrap', lineHeight: 1, fontFamily: FONT, ...style });
  // centraliza verticalmente um texto em y (equivalente ao baseline: 'middle' do PDF)
  const midY = (y: number, fontPt: number) => mm(y - (fontPt * PT_TO_MM) / 2);
  return (
    <div className="print-page" style={{ position: 'relative', width: mm(L.W), height: mm(L.H), background: '#fff', overflow: 'hidden', fontFamily: FONT }}>
      <div style={{ position: 'absolute', left: mm(h.x), top: mm(h.y), width: mm(h.w), height: mm(h.h), background: FOREST, borderRadius: mm(L.radius) }} />
      <div style={text({ left: mm(h.x + 8 * s), top: midY(h.y + h.h * 0.32, h.orgPt), fontSize: pt(h.orgPt), fontWeight: 700, color: '#a7f3d0', letterSpacing: mm(0.6 * s) })}>{model.org}</div>
      <div style={text({ left: mm(h.x + 8 * s), top: midY(h.y + h.h * 0.66, h.titlePt), fontSize: pt(h.titlePt), fontWeight: 700, color: '#fff' })}>{model.title}</div>
      <div style={text({ right: mm(L.W - h.x - h.w + 8 * s), top: midY(h.y + h.h * 0.38, h.monthPt), fontSize: pt(h.monthPt), fontWeight: 700, color: '#fff' })}>{model.monthLabel}</div>
      <div style={text({ right: mm(L.W - h.x - h.w + 8 * s), top: midY(h.y + h.h * 0.75, h.shiftPt), fontSize: pt(h.shiftPt), fontWeight: 700, color: '#a7f3d0' })}>HORÁRIO: {model.shiftLabel}</div>

      {L.cards.map((c) => {
        const rowsTop = c.y + c.headH + c.pad * 0.6;
        return (
          <div key={c.day.date}>
            <div style={{ position: 'absolute', left: mm(c.x), top: mm(c.y), width: mm(c.w), height: mm(c.h), border: `${0.4 * s}mm solid #cbd5e1`, borderRadius: mm(L.radius), boxSizing: 'border-box', overflow: 'hidden', background: '#fff' }}>
              <div style={{ height: mm(c.headH), background: tint('#047857', 0.9), borderBottom: `${0.8 * s}mm solid #047857`, boxSizing: 'border-box' }} />
              {c.footH > 0 && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: mm(c.footH), borderTop: `${0.3 * s}mm solid #e2e8f0` }} />}
            </div>
            <div style={text({ left: mm(c.x + c.pad), top: midY(c.y + c.headH * 0.3, L.fonts.weekdayPt), fontSize: pt(L.fonts.weekdayPt), fontWeight: 700, color: '#047857', letterSpacing: mm(0.5 * s) })}>{c.day.weekday}</div>
            <div style={text({ left: mm(c.x + c.pad), top: midY(c.y + c.headH * 0.66, L.fonts.datePt), fontSize: pt(L.fonts.datePt), fontWeight: 700, color: '#022c22' })}>{c.day.dayLabel}</div>
            {c.shiftDiffers && <div style={text({ right: mm(L.W - c.x - c.w + c.pad), top: midY(c.y + c.headH * 0.3, L.fonts.weekdayPt), fontSize: pt(L.fonts.weekdayPt), fontWeight: 700, color: '#155e75' })}>{c.day.shift}</div>}
            {c.rows.map((m, i) => {
              const cy = rowsTop + c.rowH * (i + 0.5);
              return (
                <div key={i}>
                  {i > 0 && <div style={{ position: 'absolute', left: mm(c.x + c.pad), width: mm(c.w - 2 * c.pad), top: mm(rowsTop + c.rowH * i), borderTop: `${0.25 * s}mm solid #e2e8f0` }} />}
                  <div style={{ position: 'absolute', left: mm(c.x + c.pad), top: mm(cy - L.dot / 2), width: mm(L.dot), height: mm(L.dot), borderRadius: '50%', boxSizing: 'border-box', ...(m.name && !m.pending ? { background: m.color } : { border: `${0.5 * s}mm solid ${m.name ? m.color : '#cbd5e1'}` }) }} />
                  {m.name ? (
                    <>
                      <div style={text({ left: mm(c.x + c.pad + L.dot + 3 * s), top: midY(cy, L.fonts.namePt), fontSize: pt(L.fonts.namePt), fontWeight: m.pending ? 400 : 700, color: m.pending ? '#64748b' : '#0f172a' })}>{m.name}</div>
                      <div style={text({ right: mm(L.W - c.x - c.w + c.pad), top: midY(cy, L.fonts.activityPt), fontSize: pt(L.fonts.activityPt), fontWeight: 700, color: m.color })}>{m.activity.toUpperCase()}</div>
                    </>
                  ) : (
                    <div style={{ position: 'absolute', left: mm(c.x + c.pad + L.dot + 3 * s), width: mm(c.w - 2 * c.pad - L.dot - 3 * s), top: mm(cy + L.fonts.namePt * PT_TO_MM * 0.35), borderTop: `${0.3 * s}mm dashed #cbd5e1` }} />
                  )}
                </div>
              );
            })}
            {c.day.note && <div style={text({ left: mm(c.x + c.pad), top: midY(c.y + c.h - c.footH - 3.5 * s, L.fonts.notePt), fontSize: pt(L.fonts.notePt), color: '#475569', maxWidth: mm(c.w - 2 * c.pad), overflow: 'hidden', textOverflow: 'ellipsis' })}>{c.day.note}</div>}
            {c.footH > 0 && (() => {
              let x = c.x + c.pad;
              const cy = c.y + c.h - c.footH / 2;
              return c.day.counts.map((k) => {
                const t = `${k.name}: ${k.count}`;
                const dotX = x;
                x += L.dot * 0.8 + 1.6 * s;
                const tx = x;
                x += pdfMeasure(t, L.fonts.countPt, true) + 6 * s;
                return (
                  <div key={k.name}>
                    <div style={{ position: 'absolute', left: mm(dotX), top: mm(cy - L.dot * 0.4), width: mm(L.dot * 0.8), height: mm(L.dot * 0.8), borderRadius: '50%', background: k.color }} />
                    <div style={text({ left: mm(tx), top: midY(cy, L.fonts.countPt), fontSize: pt(L.fonts.countPt), fontWeight: 700, color: '#334155' })}>{t}</div>
                  </div>
                );
              });
            })()}
          </div>
        );
      })}
      {L.footer && <div style={text({ left: 0, width: mm(L.W), textAlign: 'center', top: midY(L.footer.y, L.footer.pt), fontSize: pt(L.footer.pt), color: '#64748b' })}>{model.footer}</div>}
    </div>
  );
}

function ScaledSheet({ model, layout }: { model: PrintModel; layout: Layout }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pageWidthPx = (layout.W / 25.4) * 96;
    const ro = new ResizeObserver(() => setScale(Math.min(1.2, el.clientWidth / pageWidthPx)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.W]);
  const hPx = (layout.H / 25.4) * 96 * scale;
  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      <div style={{ height: hPx }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }} className="w-max shadow-[0_10px_40px_-10px_rgba(2,44,34,.35)] ring-1 ring-slate-200">
          <PrintSheet model={model} layout={layout} />
        </div>
      </div>
    </div>
  );
}

export function PrintPage() {
  const { s, year, month } = useSnapshot();
  const [paper, setPaper] = useState<Paper>(s.settings.print.paper);
  const [fullscreen, setFullscreen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const { days, issues, schedule } = useMonthView(year, month);
  const emptyTo = s.settings.print.emptySlotsToIdeal ? Math.min(s.settings.idealPerDay, s.settings.maxPerDay) : 0;
  const model = useMemo(() => buildPrintModel(s, year, month, paper), [s, year, month, paper]);
  const layout = useMemo(() => computeLayout(model, pdfMeasure, emptyTo), [model, emptyTo]);
  const hasTeam = days.some((d) => d.members.length > 0);

  // Tamanho da página de impressão acompanha o papel escolhido (vale também para Ctrl+P)
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@page { size: ${paper} landscape; margin: 0; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [paper]);

  const doPrint = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 120);
  };

  const exportPdf = () => {
    const { doc } = renderPdf(model, emptyTo);
    doc.save(`escala-sabados-${year}-${String(month).padStart(2, '0')}-${paper}.pdf`);
    toast.success('PDF gerado.');
  };

  return (
    <div>
      <PageHeader
        title="Impressão"
        description="Escala para o quadro de avisos: uma página por mês, somente informações operacionais."
        actions={
          <>
            <MonthPicker />
            <TabsRoot value={paper} onValueChange={(v) => setPaper(v as Paper)}>
              <TabsList><TabsTrigger value="A4">A4 paisagem</TabsTrigger><TabsTrigger value="A3">A3 paisagem</TabsTrigger></TabsList>
            </TabsRoot>
          </>
        }
      />
      {!hasTeam ? (
        <EmptyState icon={<CalendarX2 className="h-6 w-6" />} title={`Sem escala para ${monthLabel(year, month)}`} description="Gere e salve a escala do mês para imprimir." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
          <Card className="min-w-0 overflow-hidden bg-slate-100/80 p-4 sm:p-8">
            <ScaledSheet model={model} layout={layout} />
          </Card>
          <div className="space-y-3">
            <Button className="w-full" variant="outline" size="lg" onClick={() => setFullscreen(true)}><Expand />Visualizar impressão</Button>
            <Button className="w-full" size="lg" onClick={doPrint} disabled={printing}><Printer />Imprimir escala</Button>
            <Button className="w-full" variant="secondary" size="lg" onClick={exportPdf}><FileDown />Exportar PDF</Button>
            <Card className="space-y-2 p-4 text-sm">
              <p className="font-bold">Conferência</p>
              <p className="flex justify-between"><span className="text-muted-foreground">Papel</span><span className="font-semibold">{paper} paisagem · 1 página</span></p>
              <p className="flex justify-between"><span className="text-muted-foreground">Sábados</span><span className="font-semibold">{days.length}</span></p>
              <p className="flex justify-between"><span className="text-muted-foreground">Fonte dos nomes</span><span className="font-semibold">{layout.fonts.namePt.toFixed(1).replace('.', ',')} pt</span></p>
              <p className="flex justify-between"><span className="text-muted-foreground">Situação</span>
                {schedule?.status === 'draft' ? <Badge className="bg-amber-100 text-amber-800">Rascunho</Badge> : <Badge className="bg-emerald-100 text-emerald-800">Publicada</Badge>}
              </p>
              {hasErrors(issues) && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Atenção: a escala tem restrições obrigatórias não atendidas.</p>}
              <p className="pt-1 text-xs text-muted-foreground">Na janela de impressão, mantenha a escala em 100% (“Tamanho real”) e as margens como “Nenhuma”. Observações internas nunca são impressas.</p>
            </Card>
          </div>
        </div>
      )}

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent wide className="max-w-[min(96vw,1500px)]">
          <DialogHeader>
            <DialogTitle>Visualizar impressão — {paper} paisagem</DialogTitle>
            <DialogDescription>Exatamente como sairá na impressora e no PDF.</DialogDescription>
          </DialogHeader>
          <div className="overflow-auto bg-slate-200 p-6"><ScaledSheet model={model} layout={layout} /></div>
        </DialogContent>
      </Dialog>

      {hasTeam && createPortal(<div id="print-root" aria-hidden className="pointer-events-none fixed left-[-10000px] top-0 print:static"><PrintSheet model={model} layout={layout} /></div>, document.body)}
    </div>
  );
}
