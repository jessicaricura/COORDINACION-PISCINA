'use strict';
/* Base de datos local (IndexedDB) + buscador + asistente sin IA.
   Expone LocalApi(method, url, body, opts) con las mismas rutas que usaba la versión con servidor. */
const LocalApi = (() => {
  const STORES = ['sections', 'records', 'documents', 'docdata', 'chunks'];
  let dbp, chunks = null;
  const open = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('coordinacion', 1);
    r.onupgradeneeded = () => { const d = r.result; STORES.forEach((n) => d.createObjectStore(n, { keyPath: 'id', autoIncrement: true })); d.createObjectStore('meta', { keyPath: 'key' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(new Error('Tu navegador no permite guardar datos locales (¿modo privado?)'));
  }));
  const tx = (store, mode, fn) => open().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    let out; const r = fn(s);
    if (r) r.onsuccess = () => (out = r.result);
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  const all = (s) => tx(s, 'readonly', (o) => o.getAll());
  const get = (s, id) => tx(s, 'readonly', (o) => o.get(id));
  const put = (s, v) => tx(s, 'readwrite', (o) => o.put(v));
  const del = (s, id) => tx(s, 'readwrite', (o) => o.delete(id));
  const clear = (s) => tx(s, 'readwrite', (o) => o.clear());
  const meta = async (k) => (await tx('meta', 'readonly', (o) => o.get(k)))?.value;
  const setMeta = (k, value) => put('meta', { key: k, value });
  class Err extends Error {}
  const bad = (m) => new Err(m);
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const str = (v, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  /* ---------- Fragmentos indexados ---------- */
  const loadChunks = async () => (chunks ||= await all('chunks'));
  async function removeChunks(kind, refIds) {
    const set = new Set(refIds), list = await loadChunks();
    const gone = list.filter((c) => c.kind === kind && set.has(c.ref_id));
    chunks = list.filter((c) => !(c.kind === kind && set.has(c.ref_id)));
    for (const c of gone) { tokCache.delete(c.id); await del('chunks', c.id); }
  }
  async function addChunks(kind, ref_id, section_id, label, contents) {
    await loadChunks();
    for (const content of contents) { const c = { kind, ref_id, section_id, label, content }; c.id = await put('chunks', c); chunks.push(c); }
  }

  /* ---------- Secciones ---------- */
  async function seed() {
    if ((await all('sections')).length || (await meta('seeded'))) return;
    const tree = { Coordinación: ['Tareas pendientes', 'Incidencias', 'Personal'], Actividades: ['Horarios', 'Clases'], Instalaciones: ['Espacios', 'Mantenimiento'], Documentación: [] };
    let i = 0;
    for (const [n, kids] of Object.entries(tree)) {
      const id = await put('sections', { name: n, parent_id: null, position: i++ });
      let j = 0; for (const k of kids) await put('sections', { name: k, parent_id: id, position: j++ });
    }
    await setMeta('seeded', true);
  }
  const subtree = (secs, id) => { const out = [id]; for (const s of secs) if (s.parent_id === id) out.push(...subtree(secs, s.id)); return out; };
  async function pathOf() {
    const secs = await all('sections'), by = new Map(secs.map((s) => [s.id, s]));
    const f = (id) => { const s = by.get(id); return s ? (s.parent_id ? f(s.parent_id) + ' › ' : '') + s.name : '(sección eliminada)'; };
    return f;
  }

  /* ---------- Búsqueda ---------- */
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const STOP = new Set('de la el los las un una unos unas y o en a al del por para con sin que se es son hay como cual cuales cuando donde quien cuanto cuantos cuantas mi mis tu tus su sus lo le les me te nos dime dame necesito quiero sobre esta este estos estas ese esa eso hoy mas muy tengo tiene tienen puedes puede'.split(' '));
  const queryTokens = (q) => [...new Set((norm(q).match(/[\p{L}\p{N}]+/gu) || []).filter((t) => (t.length >= 2 && !STOP.has(t)) || /^\d+$/.test(t)))].slice(0, 14);
  const tokCache = new Map();
  const tokensOf = (c) => { let t = tokCache.get(c.id); if (!t) { t = { body: norm(c.content).match(/[\p{L}\p{N}]+/gu) || [], label: norm(c.label).match(/[\p{L}\p{N}]+/gu) || [] }; tokCache.set(c.id, t); } return t; };
  async function search(q, { sectionId, limit = 16 } = {}) {
    const qt = queryTokens(q);
    if (!qt.length) return { hits: [], tokens: qt };
    let list = await loadChunks();
    if (sectionId) { const ids = new Set(subtree(await all('sections'), sectionId)); list = list.filter((c) => ids.has(c.section_id)); }
    const match = (w, t) => (w === t ? 1 : t.length >= 3 && w.startsWith(t) ? 0.6 : 0);
    const info = list.map((c) => {
      const tk = tokensOf(c), tf = qt.map((t) => { let n = 0; for (const w of tk.body) n += match(w, t); let l = 0; for (const w of tk.label) l += match(w, t); return [n, l]; });
      return { c, tf, len: tk.body.length };
    });
    const N = info.length || 1, avg = info.reduce((a, x) => a + x.len, 0) / N || 1;
    const idf = qt.map((_, i) => { const df = info.filter((x) => x.tf[i][0] + x.tf[i][1] > 0).length; return Math.log(1 + (N - df + 0.5) / (df + 0.5)); });
    const scored = [];
    for (const x of info) {
      let score = 0, hit = 0;
      x.tf.forEach(([n, l], i) => { if (n + l > 0) hit++; score += idf[i] * ((n * 2.2) / (n + 1.2 * (0.25 + 0.75 * (x.len / avg))) + l * 1.5); });
      if (hit) scored.push({ c: x.c, score: score * (1 + 0.5 * (hit - 1)) });
    }
    scored.sort((a, b) => b.score - a.score);
    const pf = await pathOf();
    return { tokens: qt, hits: scored.slice(0, limit).map(({ c }) => ({ ...c, path: pf(c.section_id) })) };
  }

  /* ---------- Asistente sin IA: muestra lo más relevante con citas ---------- */
  const cell = (s) => String(s).replace(/\|/g, '/');
  function renderHit(h, n, tokens) {
    const lines = h.content.split('\n').map((l) => l.trim()).filter(Boolean);
    const colLine = lines.find((l) => l.startsWith('Columnas:'));
    const title = `**[${n}] ${h.label}** · ${h.path}`;
    const matches = (l) => { const nl = norm(l); return tokens.some((t) => nl.includes(t)); };
    if (colLine) {
      const cols = colLine.slice(9).split(' | ').map((s) => s.trim());
      const rows = lines.filter((l) => !l.startsWith('[') && !l.startsWith('Columnas:') && matches(l)).slice(0, 8);
      const shown = rows.length ? rows : lines.filter((l) => !l.startsWith('[') && !l.startsWith('Columnas:')).slice(0, 3);
      return `${title}\n\n| ${cols.map(cell).join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n${shown.map((r) => '| ' + r.split(' | ').map(cell).join(' | ') + ' |').join('\n')}`;
    }
    const body = h.kind === 'record' ? lines : lines.flatMap((l) => (l.length > 220 ? l.split(/(?<=[.!?])\s+/) : [l]));
    const picked = h.kind === 'record' ? body.slice(0, 7) : body.filter(matches).slice(0, 4);
    const out = (picked.length ? picked : body.slice(0, 3)).map((l) => '- ' + (l.length > 260 ? l.slice(0, 257) + '…' : l));
    return `${title}\n\n${out.join('\n')}`;
  }
  async function assistant(message, sectionId) {
    const { hits, tokens } = await search(message, { sectionId, limit: 6 });
    let answer, sources = [];
    if (!hits.length) answer = 'No encuentro nada con esas palabras en tus datos. Prueba con palabras clave distintas (el nombre de la clase, de la persona, el día…) o comprueba que el documento está subido.';
    else {
      answer = 'Esto es lo más relevante que he encontrado en tus datos:\n\n' + hits.map((h, i) => renderHit(h, i + 1, tokens)).join('\n\n');
      sources = hits.map((h, i) => ({ n: i + 1, kind: h.kind, ref_id: h.ref_id, section_id: h.section_id, label: h.label, path: h.path }));
    }
    const hist = (await meta('chat')) || [];
    hist.push({ role: 'user', content: message, sources: [] }, { role: 'assistant', content: answer, sources });
    await setMeta('chat', hist.slice(-60));
    return { answer, sources };
  }

  /* ---------- Copia de seguridad ---------- */
  const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  async function exportAll() {
    const dd = await all('docdata');
    const docdata = [];
    for (const d of dd) docdata.push({ id: d.id, text: d.text, blob: d.blob ? await toB64(d.blob) : null });
    return { app: 'coordinacion-instalacion', version: 1, exported: now(), sections: await all('sections'), records: await all('records'), documents: await all('documents'), docdata, chunks: await loadChunks(), chat: (await meta('chat')) || [] };
  }
  async function importAll(data) {
    if (!data || data.app !== 'coordinacion-instalacion') throw bad('Este archivo no es una copia de seguridad de la aplicación');
    for (const s of STORES) await clear(s);
    chunks = null; tokCache.clear();
    const putAll = (s, arr) => tx(s, 'readwrite', (o) => { (arr || []).forEach((v) => o.put(v)); });
    await putAll('sections', data.sections); await putAll('records', data.records); await putAll('documents', data.documents); await putAll('chunks', data.chunks);
    for (const d of data.docdata || []) await put('docdata', { id: d.id, text: d.text, blob: d.blob ? await (await fetch(d.blob)).blob() : null });
    await setMeta('chat', data.chat || []); await setMeta('seeded', true);
  }
  async function wipe() { for (const s of STORES) await clear(s); chunks = null; tokCache.clear(); await setMeta('chat', []); await setMeta('seeded', false); await seed(); }

  /* ---------- Documentos ---------- */
  async function processDoc(doc, file) {
    await removeChunks('doc', [doc.id]);
    try {
      const r = await Extract.extract(file);
      if (!r.chunks.length) throw new Error('No se encontró texto en el archivo');
      await addChunks('doc', doc.id, doc.section_id, doc.filename, r.chunks);
      Object.assign(doc, { status: 'ready', error: '' });
      await put('docdata', { id: doc.id, blob: file, text: (r.text || '').slice(0, 2_000_000) });
    } catch (e) {
      Object.assign(doc, { status: 'error', error: String(e.message).slice(0, 400) });
      await put('docdata', { id: doc.id, blob: file, text: '' });
    }
    await put('documents', doc);
  }

  /* ---------- Rutas ---------- */
  const handlers = {
    async 'GET /api/sections'() {
      const [secs, recs, docs] = await Promise.all([all('sections'), all('records'), all('documents')]);
      const rc = {}, dc = {};
      recs.forEach((r) => (rc[r.section_id] = (rc[r.section_id] || 0) + 1)); docs.forEach((d) => (dc[d.section_id] = (dc[d.section_id] || 0) + 1));
      return secs.sort((a, b) => a.position - b.position || a.id - b.id).map((s) => ({ id: s.id, parent_id: s.parent_id, name: s.name, icon: '', position: s.position, records: rc[s.id] || 0, documents: dc[s.id] || 0 }));
    },
    async 'POST /api/sections'(b) {
      const name = str(b.name, 80); if (!name) throw bad('El nombre es obligatorio');
      const secs = await all('sections'), parent = b.parent_id ? +b.parent_id : null;
      if (parent && !secs.some((s) => s.id === parent)) throw bad('La sección padre no existe');
      const pos = Math.max(-1, ...secs.filter((s) => s.parent_id === parent).map((s) => s.position)) + 1;
      const s = { name, parent_id: parent, position: pos }; s.id = await put('sections', s); return s;
    },
    async 'PUT /api/sections/:id'(b, { id }) {
      const s = await get('sections', id); if (!s) throw bad('No existe');
      const name = b.name !== undefined ? str(b.name, 80) : s.name; if (!name) throw bad('El nombre es obligatorio');
      let parent = s.parent_id;
      if (b.parent_id !== undefined) { parent = b.parent_id ? +b.parent_id : null; if (parent && subtree(await all('sections'), id).includes(parent)) throw bad('No puedes mover una sección dentro de sí misma'); }
      await put('sections', { ...s, name, parent_id: parent }); return { ok: true };
    },
    async 'DELETE /api/sections/:id'(b, { id }) {
      const ids = new Set(subtree(await all('sections'), id));
      const recs = (await all('records')).filter((r) => ids.has(r.section_id)), docs = (await all('documents')).filter((d) => ids.has(d.section_id));
      await removeChunks('record', recs.map((r) => r.id)); await removeChunks('doc', docs.map((d) => d.id));
      for (const r of recs) await del('records', r.id);
      for (const d of docs) { await del('documents', d.id); await del('docdata', d.id); }
      for (const s of ids) await del('sections', s);
      return { ok: true };
    },
    async 'GET /api/records'(b, p, q) {
      const sid = +q.get('section'), order = { hecho: 1 };
      return (await all('records')).filter((r) => r.section_id === sid).sort((a, b) => (order[a.status] || 0) - (order[b.status] || 0) || (a.date === '') - (b.date === '') || a.date.localeCompare(b.date) || b.id - a.id);
    },
    async 'POST /api/records'(b) { return saveRecord(null, b); },
    async 'PUT /api/records/:id'(b, { id }) { return saveRecord(id, b); },
    async 'DELETE /api/records/:id'(b, { id }) { await removeChunks('record', [id]); await del('records', id); return { ok: true }; },
    async 'GET /api/documents'(b, p, q) { return (await all('documents')).filter((d) => d.section_id === +q.get('section')).sort((a, b) => b.id - a.id); },
    async 'POST /api/documents'(file, p, q, opts) {
      const sid = +q.get('section');
      if (!(await get('sections', sid))) throw bad('Sección no válida');
      const filename = decodeURIComponent(opts?.headers?.['x-filename'] || file.name || 'archivo').slice(0, 200);
      const doc = { section_id: sid, filename, size: file.size, status: 'processing', error: '', created_at: now() };
      doc.id = await put('documents', doc);
      await processDoc(doc, file); return { id: doc.id, filename, status: doc.status };
    },
    async 'GET /api/documents/:id/text'(b, { id }) { const d = await get('documents', id), x = await get('docdata', id); if (!d) throw bad('No existe'); return { filename: d.filename, text: (x?.text || '').slice(0, 200000) }; },
    async 'POST /api/documents/:id/reprocess'(b, { id }) {
      const d = await get('documents', id), x = await get('docdata', id); if (!d || !x?.blob) throw bad('No existe');
      await processDoc(d, new File([x.blob], d.filename)); return { ok: true };
    },
    async 'DELETE /api/documents/:id'(b, { id }) { await removeChunks('doc', [id]); await del('documents', id); await del('docdata', id); return { ok: true }; },
    async 'GET /api/search'(b, p, q) {
      const { hits } = await search(q.get('q') || '', { limit: 30 });
      return hits.map((h) => ({ kind: h.kind, ref_id: h.ref_id, section_id: h.section_id, label: h.label, path: h.path, snippet: h.content.slice(0, 220) }));
    },
    async 'GET /api/chat'() { return (await meta('chat')) || []; },
    async 'POST /api/chat'(b) { const m = str(b.message, 4000); if (!m) throw bad('Escribe una pregunta'); return assistant(m, b.section_id ? +b.section_id : null); },
    async 'DELETE /api/chat'() { await setMeta('chat', []); return { ok: true }; },
  };
  async function saveRecord(id, b) {
    const title = str(b.title, 200); if (!title) throw bad('El título es obligatorio');
    if (!(await get('sections', +b.section_id))) throw bad('Sección no válida');
    const status = ['', 'pendiente', 'en curso', 'hecho'].includes(b.status) ? b.status : '';
    const old = id ? await get('records', id) : null;
    const r = { ...(old || { created_at: now() }), section_id: +b.section_id, title, body: str(b.body, 20000), status, date: str(b.date, 30), assignee: str(b.assignee, 100), updated_at: now() };
    if (id) r.id = id; r.id = await put('records', r);
    await removeChunks('record', [r.id]);
    await addChunks('record', r.id, r.section_id, r.title, [[`Registro: ${r.title}`, r.status && `Estado: ${r.status}`, r.date && `Fecha: ${r.date}`, r.assignee && `Responsable: ${r.assignee}`, r.body].filter(Boolean).join('\n')]);
    return r;
  }

  const compiled = Object.entries(handlers).map(([k, fn]) => { const [method, path] = k.split(' '); return { method, re: new RegExp('^' + path.replace(':id', '(\\d+)') + '$'), fn }; });
  async function call(method, url, body, opts) {
    const u = new URL(url, 'http://local');
    for (const r of compiled) {
      if (r.method !== method) continue;
      const m = r.re.exec(u.pathname); if (!m) continue;
      return r.fn(body || {}, { id: m[1] ? +m[1] : undefined }, u.searchParams, opts);
    }
    throw bad('Ruta no encontrada');
  }
  call.init = async () => { await open(); await seed(); try { await navigator.storage?.persist?.(); } catch {} };
  call.exportAll = exportAll; call.importAll = importAll; call.wipe = wipe;
  call.downloadDoc = async (id) => { const d = await get('documents', id), x = await get('docdata', id); if (!d || !x?.blob) throw bad('Archivo no disponible'); return { name: d.filename, blob: x.blob }; };
  call.usage = async () => { try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch { return null; } };
  return call;
})();
