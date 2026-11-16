/**
 * Minimal, dependency-free PDF 1.4 writer for system-generated documents
 * (RFQs now; POs later). Supports multi-page text with three styles using the
 * standard Helvetica fonts (WinAnsi), automatic word wrapping and page breaks.
 * Output is deterministic for identical input, which makes the SHA-256 of a
 * generated document usable as delivery evidence.
 */

export type PdfStyle = 'title' | 'heading' | 'body' | 'small' | 'mono';
export interface PdfBlock {
  text: string;
  style?: PdfStyle;
  /** Extra space before the block, in points. */
  spaceBefore?: number;
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;
const STYLES: Record<PdfStyle, { font: 'F1' | 'F2' | 'F3'; size: number; leading: number }> = {
  title: { font: 'F2', size: 18, leading: 24 },
  heading: { font: 'F2', size: 12, leading: 17 },
  body: { font: 'F1', size: 10, leading: 14 },
  small: { font: 'F1', size: 8, leading: 11 },
  mono: { font: 'F3', size: 9, leading: 12 },
};

/** Map to WinAnsi-safe characters; replace anything else with '?'. */
function sanitize(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/₹/g, 'INR ')
    .replace(/•/g, '*')
    .replace(/[^\x20-\x7E]/g, '?');
}

function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Approximate Helvetica widths: wrap by character budget (good enough for system documents). */
function wrap(text: string, style: PdfStyle): string[] {
  const { size } = STYLES[style];
  const avgChar = style === 'mono' ? size * 0.6 : size * 0.5;
  const maxChars = Math.max(10, Math.floor((PAGE_W - 2 * MARGIN) / avgChar));
  const out: string[] = [];
  for (const para of sanitize(text).split('\n')) {
    if (para.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + (line ? ' ' : '') + word).length > maxChars) {
        if (line) out.push(line);
        let w = word;
        while (w.length > maxChars) {
          out.push(w.slice(0, maxChars));
          w = w.slice(maxChars);
        }
        line = w;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out;
}

export function renderPdf(blocks: PdfBlock[], meta: { title: string; footer?: string }): Buffer {
  const pages: string[] = [];
  let ops: string[] = [];
  let y = PAGE_H - MARGIN;
  const newPage = () => {
    if (ops.length) pages.push(ops.join('\n'));
    ops = [];
    y = PAGE_H - MARGIN;
  };
  for (const block of blocks) {
    const style = block.style ?? 'body';
    const { font, size, leading } = STYLES[style];
    y -= block.spaceBefore ?? 0;
    for (const line of wrap(block.text, style)) {
      if (y - leading < MARGIN + 20) newPage();
      y -= leading;
      ops.push(`BT /${font} ${size} Tf ${MARGIN} ${y.toFixed(2)} Td (${escapePdf(line)}) Tj ET`);
    }
  }
  newPage();

  const total = pages.length;
  const footer = sanitize(meta.footer ?? meta.title);
  const contents = pages.map(
    (p, i) => `${p}\nBT /F1 8 Tf ${MARGIN} 30 Td (${escapePdf(`${footer}  -  page ${i + 1} of ${total}`)}) Tj ET`,
  );

  // Objects: 1 catalog, 2 pages, 3-5 fonts, then (page, content) pairs, then info.
  const objects: string[] = [];
  const pageIds = contents.map((_, i) => 6 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${total} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  contents.forEach((c, i) => {
    const pageId = 6 + i * 2;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(c, 'latin1')} >>\nstream\n${c}\nendstream`;
  });
  const infoId = 6 + contents.length * 2;
  objects[infoId] = `<< /Title (${escapePdf(sanitize(meta.title))}) /Producer (Kenzo-Kore BusinessOS) >>`;

  let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
