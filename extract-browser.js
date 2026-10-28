'use strict';
/* Lectura de documentos dentro del navegador (sin servidor, sin coste).
   Word/Excel/CSV/texto: código propio. PDF: pdf.js (CDN gratuito). Fotos: Tesseract.js (CDN gratuito). */
const Extract = (() => {
  /* ---------- ZIP ---------- */
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  function readZip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let i = u8.length - 22;
    const min = Math.max(0, u8.length - 65557);
    for (; i >= min; i--) if (dv.getUint32(i, true) === 0x06054b50) break;
    if (i < min) throw new Error('El archivo no es un Office válido');
    const count = dv.getUint16(i + 10, true);
    let off = dv.getUint32(i + 16, true);
    const files = new Map(), td = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      files.set(td.decode(u8.subarray(off + 46, off + 46 + nlen)), { method, csize, lho });
      off += 46 + nlen + elen + clen;
    }
    return {
      async text(name) {
        const f = files.get(name);
        if (!f) return '';
        const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true);
        const data = u8.subarray(start, start + f.csize);
        return td.decode(f.method === 0 ? data : await inflateRaw(data));
      },
    };
  }
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
  const attr = (tag, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag); return m ? decode(m[1]) : null; };

  /* ---------- DOCX ---------- */
  async function docxText(buf) {
    const x = await readZip(buf).text('word/document.xml');
    if (!x) throw new Error('No se encontró el contenido del documento Word');
    return decode(x.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''))
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- XLSX ---------- */
  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  const pad = (n) => String(n).padStart(2, '0');
  function serialToText(v) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return Math.floor(v) === 0 ? time : v % 1 === 0 ? date : `${date} ${time}`;
  }
  const colIndex = (ref) => { let n = 0; for (const ch of /^[A-Z]+/i.exec(ref)[0].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  async function xlsxSheets(buf) {
    const z = readZip(buf);
    const shared = [];
    for (const m of (await z.text('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      let t = ''; for (const x of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) t += x[1]; shared.push(decode(t));
    }
    const styles = await z.text('xl/styles.xml');
    const custom = {};
    for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) custom[attr(m[0], 'numFmtId')] = attr(m[0], 'formatCode') || '';
    const dateStyle = [];
    const xfBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
    if (xfBlock) for (const m of xfBlock[1].matchAll(/<xf\b[^>]*>/g)) {
      const id = parseInt(attr(m[0], 'numFmtId') || '0', 10);
      let isDate = BUILTIN_DATE.has(id);
      if (custom[id] !== undefined) isDate = /[dmyhs]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
      dateStyle.push(isDate);
    }
    const rels = {};
    for (const m of (await z.text('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)) rels[attr(m[0], 'Id')] = attr(m[0], 'Target');
    const sheets = [];
    for (const m of (await z.text('xl/workbook.xml')).matchAll(/<sheet\b[^>]*>/g)) {
      const name = attr(m[0], 'name');
      let target = rels[attr(m[0], 'r:id')];
      if (!target) continue;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      const xml = await z.text(target);
      if (!xml) continue;
      const rows = [];
      for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const row = [];
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const a = c[1], ref = attr(a, 'r');
          if (!ref || c[2] === undefined) continue;
          const t = attr(a, 't'), s = attr(a, 's'), vm = /<v>([\s\S]*?)<\/v>/.exec(c[2]);
          let val = '';
          if (t === 'inlineStr') { for (const x of c[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) val += decode(x[1]); }
          else if (vm) {
            const raw = decode(vm[1]);
            if (t === 's') val = shared[+raw] ?? '';
            else if (t === 'b') val = raw === '1' ? 'Sí' : 'No';
            else if (t === 'str') val = raw;
            else if (t === 'e') val = '';
            else { const num = Number(raw); val = Number.isFinite(num) ? (dateStyle[+s] ? serialToText(num) : String(Math.round(num * 1e9) / 1e9)) : raw; }
          }
          row[colIndex(ref)] = String(val).trim();
        }
        if (row.some((x) => x)) rows.push(Array.from(row, (x) => x || ''));
        if (rows.length >= 20000) break;
      }
      if (rows.length) sheets.push({ name, rows });
    }
    return sheets;
  }

  /* ---------- CSV ---------- */
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); cell = ''; if (row.some((x) => x)) rows.push(row); row = []; }
      else cell += ch;
    }
    row.push(cell.trim()); if (row.some((x) => x)) rows.push(row);
    return rows.slice(0, 20000);
  }

  /* ---------- Troceado ---------- */
  function chunkText(text, max = 1500) {
    const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean), out = [];
    let cur = ''; const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
    for (const p of paras) {
      if (p.length > max) { flush(); for (let i = 0; i < p.length; i += max - 150) out.push(p.slice(i, i + max).trim()); }
      else if (cur.length + p.length + 2 > max) { flush(); cur = p; }
      else cur += (cur ? '\n\n' : '') + p;
    }
    flush(); return out;
  }
  function rowsToChunks(prefix, rows, max = 1800) {
    if (!rows.length) return [];
    const head = `[${prefix}]\nColumnas: ${rows[0].join(' | ')}\n`, out = [];
    let cur = head;
    for (const r of rows.slice(1)) {
      const line = r.join(' | ');
      if (cur.length + line.length + 1 > max && cur !== head) { out.push(cur.trim()); cur = head; }
      cur += line.slice(0, max) + '\n';
    }
    if (cur !== head) out.push(cur.trim());
    return out.length ? out : [head.trim()];
  }

  /* ---------- Librerías externas gratuitas (carga bajo demanda) ---------- */
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar un componente externo (¿sin conexión?)')); document.head.append(s); });
  async function pdfText(buf) {
    if (!window.pdfjsLib) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      let line = '', lastY = null;
      for (const it of content.items) {
        const y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 3) { text += line.trim() + '\n'; line = ''; }
        line += it.str + (it.hasEOL ? '\n' : ' '); lastY = y;
      }
      text += line.trim() + '\n\n';
    }
    text = text.trim();
    if (text.length < 20) throw new Error('El PDF parece escaneado (sin texto). Sácale una foto o captura y súbela como imagen para leerla con OCR.');
    return text;
  }
  async function imageText(file) {
    if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    const r = await window.Tesseract.recognize(file, 'spa+eng');
    const text = (r.data.text || '').trim();
    if (text.length < 5) throw new Error('No se pudo leer texto en la imagen (prueba con una foto más nítida y recta)');
    return text;
  }

  /* ---------- Punto de entrada: devuelve { text, chunks } ---------- */
  async function extract(file) {
    const name = file.name, ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') { const t = await pdfText(await file.arrayBuffer()); return { text: t, chunks: chunkText(t) }; }
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) { const t = await imageText(file); return { text: t, chunks: chunkText(t) }; }
    if (ext === 'docx') { const t = await docxText(await file.arrayBuffer()); return { text: t, chunks: chunkText(t) }; }
    if (ext === 'xlsx' || ext === 'xlsm') {
      const sheets = await xlsxSheets(await file.arrayBuffer());
      if (!sheets.length) throw new Error('El Excel no contiene datos');
      const chunks = []; let text = '';
      for (const s of sheets) { chunks.push(...rowsToChunks(`${name} › hoja "${s.name}"`, s.rows)); text += `## ${s.name}\n` + s.rows.map((r) => r.join(' | ')).join('\n') + '\n\n'; }
      return { text, chunks };
    }
    if (ext === 'csv' || ext === 'tsv') { const rows = parseCsv(await file.text()); return { text: rows.map((r) => r.join(' | ')).join('\n'), chunks: rowsToChunks(name, rows) }; }
    if (['txt', 'md', 'json', 'log'].includes(ext)) { const t = await file.text(); return { text: t, chunks: chunkText(t) }; }
    if (ext === 'doc' || ext === 'xls') throw new Error('Formato antiguo (.doc/.xls): guárdalo como .docx/.xlsx y súbelo de nuevo');
    throw new Error(`Formato .${ext} no admitido (usa PDF, Word, Excel, CSV, imágenes o texto)`);
  }
  return { extract, chunkText };
})();
