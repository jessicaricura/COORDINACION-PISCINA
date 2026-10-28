'use strict';
/* ============ Utilidades ============ */
const $app = document.getElementById('app');
const state = { user: null, sections: [], current: null, view: 'section', tab: 'records', expanded: new Set(JSON.parse(localStorage.getItem('exp') || '[]')), chatScope: false, pollTimer: null };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), err ? 4500 : 2500);
}
async function api(method, url, body, opts = {}) { return LocalApi(method, url, body, opts); }
const run = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); } };
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const fmtDate = (d) => { if (!d) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };

function modal(title, bodyEl, buttons) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => e.target === bg && bg.remove() },
    h('div', { class: 'modal', role: 'dialog' }, h('h2', null, title), bodyEl, buttons ? h('div', { class: 'foot' }, buttons(() => bg.remove())) : null));
  document.body.append(bg);
  bg.querySelector('input,textarea,select')?.focus();
  return () => bg.remove();
}
const confirmBox = (text, onOk, label = 'Eliminar') =>
  modal('Confirmar', h('p', null, text), (close) => [h('button', { class: 'btn', onclick: close }, 'Cancelar'), h('button', { class: 'btn primary', onclick: () => { close(); onOk(); } }, label)]);

/* ============ Árbol de secciones ============ */
const kidsOf = (id) => state.sections.filter((s) => s.parent_id === id);
const byId = (id) => state.sections.find((s) => s.id === id);
function pathOf(id) { const p = []; for (let s = byId(id); s; s = byId(s.parent_id)) p.unshift(s); return p; }
function totalCount(id) { return kidsOf(id).reduce((n, k) => n + totalCount(k.id), 0) + (byId(id).records + byId(id).documents); }
async function loadSections() { state.sections = await api('GET', '/api/sections'); }
function openSection(id) {
  state.current = id; state.view = 'section';
  pathOf(id).slice(0, -1).forEach((s) => state.expanded.add(s.id));
  persistExpanded(); closeDrawer(); render();
}
const persistExpanded = () => localStorage.setItem('exp', JSON.stringify([...state.expanded]));

function treeNode(s) {
  const kids = kidsOf(s.id), open = state.expanded.has(s.id);
  return h('div', null,
    h('div', { class: 'node' + (state.view === 'section' && state.current === s.id ? ' active' : '') },
      h('button', { class: 'tg', 'aria-label': 'Desplegar', onclick: () => { open ? state.expanded.delete(s.id) : state.expanded.add(s.id); persistExpanded(); renderSide(); } }, kids.length ? (open ? '▾' : '▸') : '·'),
      h('button', { class: 'nm', onclick: () => openSection(s.id) }, s.name),
      h('span', { class: 'ct' }, totalCount(s.id) || ''),
      h('span', { class: 'acts' },
        h('button', { title: 'Añadir subsección', onclick: () => sectionForm(null, s.id) }, '＋'),
        h('button', { title: 'Renombrar o mover', onclick: () => sectionForm(s) }, '✎'),
        h('button', { title: 'Eliminar', onclick: () => deleteSection(s) }, '🗑'))),
    kids.length && open ? h('div', { class: 'kids' }, kids.map(treeNode)) : null);
}
function sectionForm(section, parentId) {
  const name = h('input', { value: section ? section.name : '', maxlength: 80, placeholder: 'Nombre de la sección' });
  const parent = h('select', null, h('option', { value: '' }, '— Nivel principal —'));
  if (section) {
    const forbidden = new Set(); const mark = (id) => { forbidden.add(id); kidsOf(id).forEach((k) => mark(k.id)); }; mark(section.id);
    state.sections.filter((s) => !forbidden.has(s.id)).forEach((s) => parent.append(h('option', { value: s.id }, pathOf(s.id).map((x) => x.name).join(' › '))));
    parent.value = section.parent_id ?? '';
  }
  const form = section ? [h('div', { class: 'field' }, h('label', null, 'Nombre'), name), h('div', { class: 'field' }, h('label', null, 'Ubicación'), parent)] : [h('div', { class: 'field' }, h('label', null, parentId ? `Nueva subsección dentro de «${byId(parentId).name}»` : 'Nueva sección principal'), name)];
  modal(section ? 'Editar sección' : 'Nueva sección', h('div', null, form), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Cancelar'),
    h('button', { class: 'btn primary', onclick: () => run(async () => {
      if (section) await api('PUT', `/api/sections/${section.id}`, { name: name.value, parent_id: parent.value ? +parent.value : null });
      else { const s = await api('POST', '/api/sections', { name: name.value, parent_id: parentId || null }); if (parentId) state.expanded.add(parentId); persistExpanded(); state.current = s.id; state.view = 'section'; }
      close(); await loadSections(); render();
    }) }, 'Guardar')]);
  name.addEventListener('keydown', (e) => e.key === 'Enter' && e.target.closest('.modal').querySelector('.primary').click());
}
function deleteSection(s) {
  const n = totalCount(s.id), hasKids = kidsOf(s.id).length;
  confirmBox(`¿Eliminar «${s.name}»${hasKids ? ' y todas sus subsecciones' : ''}? Se borrarán también ${n} registros y documentos que contiene. No se puede deshacer.`, () => run(async () => {
    await api('DELETE', `/api/sections/${s.id}`);
    if (state.current === s.id || !byId(state.current)) state.current = null;
    await loadSections(); if (!byId(state.current)) state.current = state.sections.find((x) => !x.parent_id)?.id ?? null; render(); toast('Sección eliminada');
  }));
}

/* ============ Estructura general ============ */
let drawer = false;
const closeDrawer = () => { drawer = false; document.querySelector('.side')?.classList.remove('open'); document.querySelector('.scrim')?.remove(); };
function openDrawer() {
  document.querySelector('.side').classList.add('open');
  document.body.append(h('div', { class: 'scrim', onclick: closeDrawer }));
}
function renderSide() {
  const tree = document.querySelector('.tree'); if (!tree) return;
  tree.replaceChildren(...kidsOf(null).map(treeNode), h('button', { class: 'btn sm addroot', onclick: () => sectionForm(null, null) }, '＋ Nueva sección principal'));
  document.querySelectorAll('.side-foot .nav').forEach((n) => n.classList.toggle('active', n.dataset.view === state.view));
}
function shell() {
  const search = h('input', { type: 'search', placeholder: 'Buscar en todo…', onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { state.view = 'search'; state.query = e.target.value.trim(); closeDrawer(); render(); } } });
  const nav = (view, icon, label) => h('button', { class: 'nav', 'data-view': view, onclick: () => { state.view = view; closeDrawer(); render(); } }, h('span', null, icon), label);
  return h('div', { class: 'shell' },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, h('div', { class: 'logo' }, '◎'), h('div', null, 'Coordinación', h('div', { class: 'muted', style: 'font-size:12px;font-weight:400' }, 'Datos guardados en este dispositivo'))),
      h('div', { class: 'search' }, search),
      h('div', { class: 'tree' }),
      h('div', { class: 'side-foot' }, nav('chat', '💬', 'Preguntar a mis datos'), nav('settings', '⚙️', 'Datos y copia de seguridad'))),
    h('div', { class: 'main' },
      h('div', { class: 'top' }, h('button', { class: 'icon', 'aria-label': 'Menú', onclick: openDrawer }, '☰'), h('strong', { id: 'toptitle' }, 'Coordinación')),
      h('div', { class: 'content', id: 'content' })));
}

async function render() {
  clearInterval(state.pollTimer);
    if (!document.querySelector('.shell')) { $app.replaceChildren(shell()); }
  if (!state.sections.length) await loadSections();
  if (state.current && !byId(state.current)) state.current = null;
  if (!state.current) state.current = kidsOf(null)[0]?.id ?? null;
  renderSide();
  const c = document.getElementById('content');
  c.replaceChildren();
  c.style.padding = state.view === 'chat' ? '14px clamp(14px,3vw,36px)' : '';
  if (state.view === 'chat') return viewChat(c);
  if (state.view === 'settings') return viewSettings(c);
  if (state.view === 'search') return viewSearch(c);
  return viewSection(c);
}

/* ============ Sección ============ */
async function viewSection(c) {
  const s = byId(state.current);
  if (!s) { c.append(h('div', { class: 'inner' }, h('div', { class: 'empty' }, 'Crea tu primera sección con el botón «Nueva sección principal».'))); return; }
  document.getElementById('toptitle').textContent = s.name;
  const crumbs = pathOf(s.id).slice(0, -1);
  const subs = kidsOf(s.id);
  const inner = h('div', { class: 'inner' },
    backupNotice(state.sections.reduce((n, x) => n + x.records + x.documents, 0)),
    h('div', { class: 'crumbs' }, crumbs.map((p, i) => [h('a', { href: '#', onclick: (e) => { e.preventDefault(); openSection(p.id); } }, p.name), ' › '])),
    h('div', { class: 'head', style: 'margin-bottom:12px' }, h('h1', null, s.name), h('button', { class: 'btn sm', onclick: () => sectionForm(null, s.id) }, '＋ Subsección')),
    subs.length ? h('div', { class: 'subs' }, subs.map((k) => h('button', { class: 'btn sm', onclick: () => openSection(k.id) }, '📁 ' + k.name, ' ', h('span', { class: 'badge' }, totalCount(k.id))))) : null,
    h('div', { class: 'tabs' },
      h('button', { class: 'tab' + (state.tab === 'records' ? ' active' : ''), onclick: () => { state.tab = 'records'; render(); } }, 'Registros', h('span', { class: 'badge' }, s.records)),
      h('button', { class: 'tab' + (state.tab === 'docs' ? ' active' : ''), onclick: () => { state.tab = 'docs'; render(); } }, 'Documentos', h('span', { class: 'badge' }, s.documents))),
    h('div', { id: 'tabbody' }));
  c.append(inner);
  if (state.tab === 'records') await tabRecords(s); else await tabDocs(s);
}

async function tabRecords(s) {
  const body = document.getElementById('tabbody');
  const recs = await run(() => api('GET', `/api/records?section=${s.id}`)) || [];
  body.append(h('div', { style: 'margin-bottom:12px' }, h('button', { class: 'btn primary', onclick: () => recordForm(s) }, '＋ Nuevo registro')));
  if (!recs.length) return body.append(h('div', { class: 'empty' }, 'Aún no hay registros. Úsalos para tareas, incidencias, personal, notas o cualquier dato que quieras consultar luego con la IA.'));
  body.append(h('div', { class: 'list' }, recs.map((r) => h('div', { class: 'card item' },
    h('div', { class: 't' }, h('h3', null, r.title), r.status ? h('span', { class: 'badge ' + r.status.replace(' ', '-') }, r.status) : null),
    h('div', { class: 'meta' }, r.date ? '📅 ' + fmtDate(r.date) : null, r.assignee ? '👤 ' + r.assignee : null),
    r.body ? h('div', { class: 'body' }, r.body) : null,
    h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: () => recordForm(s, r) }, 'Editar'),
      h('button', { class: 'btn sm danger', onclick: () => confirmBox(`¿Eliminar «${r.title}»?`, () => run(async () => { await api('DELETE', `/api/records/${r.id}`); await loadSections(); render(); })) }, 'Eliminar'))))));
}
function recordForm(s, r) {
  const f = { title: h('input', { value: r?.title || '', maxlength: 200, placeholder: 'Ej.: Revisar bomba de la piscina' }), status: h('select', null, ['', 'pendiente', 'en curso', 'hecho'].map((v) => h('option', { value: v }, v || '— sin estado —'))), date: h('input', { type: 'date', value: r?.date || '' }), assignee: h('input', { value: r?.assignee || '', maxlength: 100, placeholder: 'Persona o equipo' }), body: h('textarea', { rows: 6, placeholder: 'Detalles, notas, teléfonos…' }) };
  f.status.value = r?.status || ''; f.body.value = r?.body || '';
  const fld = (l, el) => h('div', { class: 'field' }, h('label', null, l), el);
  modal(r ? 'Editar registro' : 'Nuevo registro', h('div', null, fld('Título', f.title), h('div', { class: 'row' }, fld('Estado', f.status), fld('Fecha', f.date)), fld('Responsable', f.assignee), fld('Notas', f.body)), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Cancelar'),
    h('button', { class: 'btn primary', onclick: () => run(async () => {
      const payload = { section_id: s.id, title: f.title.value, status: f.status.value, date: f.date.value, assignee: f.assignee.value, body: f.body.value };
      r ? await api('PUT', `/api/records/${r.id}`, payload) : await api('POST', '/api/records', payload);
      close(); await loadSections(); render(); toast('Guardado');
    }) }, 'Guardar')]);
}

async function tabDocs(s) {
  const body = document.getElementById('tabbody');
  const docs = await run(() => api('GET', `/api/documents?section=${s.id}`)) || [];
  const file = h('input', { type: 'file', multiple: true, class: 'hidden', accept: '.pdf,.docx,.xlsx,.xlsm,.csv,.tsv,.txt,.md,.png,.jpg,.jpeg,.webp,.gif', onchange: (e) => upload(s, [...e.target.files]) });
  const drop = h('div', { class: 'drop' }, h('div', null, 'Arrastra aquí tus archivos o'), h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: () => file.click() }, '📎 Subir archivos')), h('div', { class: 'muted', style: 'font-size:13px;margin-top:8px' }, 'PDF, Word, Excel, CSV, fotos o texto · máx. 25 MB cada uno'), file);
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => upload(s, [...e.dataTransfer.files]));
  body.append(drop);
  const label = { processing: 'Procesando…', ready: 'Listo', pending: 'Pendiente de clave IA', error: 'Error' };
  if (!docs.length) body.append(h('div', { class: 'empty' }, 'Sin documentos en esta sección.'));
  else body.append(h('div', { class: 'list' }, docs.map((d) => h('div', { class: 'card item' },
    h('div', { class: 't' }, h('h3', { style: 'overflow-wrap:anywhere' }, '📄 ' + d.filename), h('span', { class: 'badge ' + d.status }, label[d.status] || d.status)),
    h('div', { class: 'meta' }, fmtSize(d.size), ' · ', fmtDate(d.created_at)),
    d.error ? h('div', { style: 'color:var(--bad);font-size:14px' }, d.error) : null,
    h('div', { class: 'btns' },
      d.status === 'ready' ? h('button', { class: 'btn sm', onclick: () => viewDocText(d) }, 'Ver texto extraído') : null,
      h('button', { class: 'btn sm', onclick: () => downloadDoc(d) }, 'Descargar'),
      d.status !== 'ready' ? h('button', { class: 'btn sm', onclick: () => run(async () => { await api('POST', `/api/documents/${d.id}/reprocess`); render(); }) }, 'Reprocesar') : null,
      h('button', { class: 'btn sm danger', onclick: () => confirmBox(`¿Eliminar «${d.filename}»?`, () => run(async () => { await api('DELETE', `/api/documents/${d.id}`); await loadSections(); render(); })) }, 'Eliminar'))))));
  if (docs.some((d) => d.status === 'processing')) state.pollTimer = setInterval(async () => { if (state.view === 'section' && state.tab === 'docs' && state.current === s.id) { await loadSections(); render(); } }, 3000);
}
async function downloadDoc(d) {
  const r = await run(() => LocalApi.downloadDoc(d.id)); if (!r) return;
  const a = h('a', { href: URL.createObjectURL(r.blob), download: r.name }); document.body.append(a); a.click(); a.remove();
}
async function upload(s, files) {
  for (const f of files) {
    if (f.size > 25 * 1024 * 1024) { toast(`«${f.name}» supera 25 MB`, true); continue; }
    toast(`Leyendo ${f.name}…`);
    try { await api('POST', `/api/documents?section=${s.id}`, f, { raw: true, headers: { 'x-filename': encodeURIComponent(f.name) } }); }
    catch (e) { toast(`${f.name}: ${e.message}`, true); }
  }
  await loadSections(); render();
}
async function viewDocText(d) {
  const r = await run(() => api('GET', `/api/documents/${d.id}/text`)); if (!r) return;
  modal(r.filename, h('pre', null, r.text || '(vacío)'), (close) => [h('button', { class: 'btn', onclick: close }, 'Cerrar')]);
}

/* ============ Búsqueda ============ */
async function viewSearch(c) {
  document.getElementById('toptitle').textContent = 'Búsqueda';
  const res = await run(() => api('GET', '/api/search?q=' + encodeURIComponent(state.query))) || [];
  c.append(h('div', { class: 'inner' }, h('h1', { style: 'margin-bottom:14px' }, `Resultados para «${state.query}»`),
    res.length ? h('div', { class: 'list' }, res.map((r) => h('div', { class: 'card hit item', onclick: () => { state.tab = r.kind === 'doc' ? 'docs' : 'records'; openSection(r.section_id); } },
      h('div', { class: 't' }, h('h3', null, (r.kind === 'doc' ? '📄 ' : '📝 ') + r.label)), h('div', { class: 'meta' }, r.path), h('div', { class: 'sn' }, r.snippet)))) : h('div', { class: 'empty' }, 'Sin resultados. Prueba con otras palabras o pregunta a la IA.')));
}

/* ============ Chat ============ */
function md(text) {
  const lines = esc(text).split('\n'); const out = []; let i = 0;
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[(\d+)\]/g, '<sup>[$1]</sup>');
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((x) => inline(x.trim()));
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>`);
    } else if (/^\s*([-*•]|\d+\.)\s+/.test(l)) {
      const ord = /^\s*\d+\./.test(l); const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*([-*•]|\d+\.)\s+/, '')));
      out.push(`<${ord ? 'ol' : 'ul'}>${items.map((x) => `<li>${x}</li>`).join('')}</${ord ? 'ol' : 'ul'}>`);
    } else if (/^#{1,4}\s/.test(l)) { out.push(`<p><b>${inline(l.replace(/^#+\s*/, ''))}</b></p>`); i++; }
    else if (!l.trim()) i++;
    else { const para = []; while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*•]\s|\d+\.\s|#)/.test(lines[i])) para.push(inline(lines[i++])); out.push(`<p>${para.join('<br>')}</p>`); }
  }
  return out.join('');
}
function msgEl(m) {
  const el = h('div', { class: 'msg ' + m.role });
  if (m.role === 'user') el.textContent = m.content;
  else {
    el.innerHTML = md(m.content);
    if (m.sources?.length) el.append(h('div', { class: 'srcs' }, m.sources.map((s) => h('a', { class: 'src', title: s.path, onclick: () => { state.tab = s.kind === 'doc' ? 'docs' : 'records'; if (byId(s.section_id)) openSection(s.section_id); else toast('Esa sección ya no existe', true); } }, `[${s.n}] ${s.label.length > 38 ? s.label.slice(0, 36) + '…' : s.label}`))));
  }
  return el;
}
async function viewChat(c) {
  document.getElementById('toptitle').textContent = 'Preguntar a mis datos';
  const hist = await run(() => api('GET', '/api/chat')) || [];
  const msgs = h('div', { class: 'msgs' });
  const sec = byId(state.current);
  const input = h('textarea', { rows: 1, placeholder: 'Escribe palabras clave: natación lunes, Marta, ducha…', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }, oninput: (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; } });
  const btn = h('button', { class: 'btn primary', onclick: () => ask() }, 'Enviar');
  const scope = sec ? h('label', { class: 'muted', style: 'font-size:13px;display:flex;gap:6px;align-items:center;margin-bottom:8px' }, h('input', { type: 'checkbox', checked: state.chatScope, onchange: (e) => (state.chatScope = e.target.checked) }), `Buscar solo en «${sec.name}» y sus subsecciones`) : null;
  async function ask(text) {
    text = (text || input.value).trim(); if (!text || btn.disabled) return;
    input.value = ''; input.style.height = 'auto'; btn.disabled = true;
    msgs.querySelector('.sugg')?.remove();
    msgs.append(msgEl({ role: 'user', content: text }));
    const typing = h('div', { class: 'msg assistant typing' }, 'Buscando…'); msgs.append(typing); msgs.scrollTop = msgs.scrollHeight;
    try {
      const r = await api('POST', '/api/chat', { message: text, section_id: state.chatScope && sec ? sec.id : null });
      typing.replaceWith(msgEl({ role: 'assistant', content: r.answer, sources: r.sources }));
    } catch (e) { typing.replaceWith(h('div', { class: 'msg assistant', style: 'color:var(--bad)' }, e.message)); }
    btn.disabled = false; msgs.scrollTop = msgs.scrollHeight; input.focus();
  }
  hist.forEach((m) => msgs.append(msgEl(m)));
  if (!hist.length) msgs.append(h('div', null, h('h2', { style: 'margin-bottom:6px' }, '¿Qué quieres encontrar?'), h('p', { class: 'muted', style: 'margin:0 0 10px' }, 'Busco en tus registros y documentos y te muestro lo más relevante, indicando de dónde sale cada dato. Usa palabras clave.'),
    h('div', { class: 'sugg' }, ['clases lunes tarde', 'tareas pendientes', 'recepción turno', 'protocolo incidencias'].map((t) => h('button', { class: 'btn sm', onclick: () => ask(t) }, t)))));
  c.append(h('div', { class: 'chat' },
    h('div', { class: 'head', style: 'margin-bottom:8px' }, h('h1', null, '💬 Preguntar a mis datos'), hist.length ? h('button', { class: 'btn sm', onclick: () => confirmBox('¿Borrar la conversación?', () => run(async () => { await api('DELETE', '/api/chat'); render(); }), 'Borrar') }, 'Nueva conversación') : null),
    msgs, scope, h('div', { class: 'chatbar' }, input, btn)));
  msgs.scrollTop = msgs.scrollHeight;
}

/* ============ Ajustes ============ */
const fmtMB = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB';
function backupNotice(total) {
  const last = +localStorage.getItem('lastBackup') || 0;
  if (!total || Date.now() - last < 14 * 86400000) return null;
  return h('div', { class: 'card', style: 'margin-bottom:14px;background:var(--warn-l);border-color:transparent;color:var(--warn)' }, '⚠️ Tus datos solo están en este dispositivo. ',
    h('a', { href: '#', style: 'color:inherit;font-weight:600', onclick: (e) => { e.preventDefault(); state.view = 'settings'; render(); } }, 'Descarga una copia de seguridad'), '.');
}
async function viewSettings(c) {
  document.getElementById('toptitle').textContent = 'Datos y copia de seguridad';
  const usage = await LocalApi.usage();
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: (e) => {
    const f = e.target.files[0]; if (!f) return;
    confirmBox('Restaurar sustituirá TODOS los datos actuales de este dispositivo por los de la copia. ¿Continuar?', () => run(async () => {
      await LocalApi.importAll(JSON.parse(await f.text())); state.sections = []; state.current = null; toast('Copia restaurada'); render();
    }), 'Restaurar');
  } });
  const last = +localStorage.getItem('lastBackup');
  c.append(h('div', { class: 'inner' }, h('h1', { style: 'margin-bottom:16px' }, 'Datos y copia de seguridad'),
    h('div', { class: 'card', style: 'margin-bottom:16px' }, h('h2', { style: 'font-size:18px;margin-bottom:6px' }, 'Tus datos'),
      h('p', { class: 'muted', style: 'margin:0 0 10px' }, 'Todo se guarda en este navegador y este dispositivo; no se envía a ningún servidor. Si borras los datos del navegador o cambias de dispositivo, se pierden salvo que tengas copia de seguridad.',
        usage ? ` Espacio usado: ${fmtMB(usage.used)}.` : '', last ? ` Última copia: ${new Date(last).toLocaleDateString('es-ES')}.` : ' Aún no has hecho ninguna copia.'),
      h('div', { class: 'row', style: 'gap:8px' },
        h('button', { class: 'btn primary', style: 'flex:none', onclick: () => run(async () => {
          const data = await LocalApi.exportAll();
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), download: `coordinacion-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove(); localStorage.setItem('lastBackup', Date.now()); toast('Copia descargada'); render();
        }) }, '⬇️ Descargar copia'),
        h('button', { class: 'btn', style: 'flex:none', onclick: () => file.click() }, '⬆️ Restaurar copia'), file,
        h('button', { class: 'btn danger', style: 'flex:none', onclick: () => confirmBox('Se borrarán TODAS las secciones, registros y documentos de este dispositivo. No se puede deshacer.', () => run(async () => { await LocalApi.wipe(); state.sections = []; state.current = null; toast('Datos borrados'); render(); }), 'Borrar todo') }, 'Borrar todo'))),
    h('div', { class: 'card' }, h('h2', { style: 'font-size:18px;margin-bottom:6px' }, 'Sobre esta versión gratuita'),
      h('ul', { class: 'muted', style: 'margin:0;padding-left:20px' },
        h('li', null, 'El asistente no usa IA: busca por palabras clave y te muestra los fragmentos y filas más relevantes con su fuente.'),
        h('li', null, 'Word, Excel, CSV y texto se leen sin conexión. PDF y fotos necesitan internet la primera vez (componentes gratuitos).'),
        h('li', null, 'Los PDF escaneados y las fotos se leen con OCR: la calidad depende de la imagen.'),
        h('li', null, 'Para compartir datos entre varios dispositivos o usar IA de verdad existe la versión con servidor.')))));
}

/* ============ Arranque ============ */
(async () => {
  try { await LocalApi.init(); } catch (e) { $app.textContent = e.message; return; }
  state.user = { username: 'Este dispositivo', role: 'admin' };
  render();
})();
