import writeXlsxFile from 'write-excel-file/browser';

type Cell = string | number;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** CSV com separador ";" e BOM UTF-8 — abre corretamente no Excel em português. */
export function downloadCsv(filename: string, header: string[], rows: Cell[][]) {
  const esc = (v: Cell) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), filename);
}

export async function downloadXlsx(filename: string, header: string[], rows: Cell[][]) {
  const data = [
    header.map((h) => ({ value: h, fontWeight: 'bold' as const, backgroundColor: '#ecfdf5' })),
    ...rows.map((r) => r.map((v) => ({ value: v, type: typeof v === 'number' ? Number : String }))),
  ];
  const blob = await writeXlsxFile(data as never, { columns: header.map((h, i) => ({ width: i < 2 ? 28 : Math.max(10, h.length + 2) })) } as never).toBlob();
  download(blob, filename);
}
