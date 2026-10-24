/* SVE Website Editor: the page inside the editor window.
   All website data is loaded once, edited here, kept as a draft on this computer, and sent to the
   website in one go when "Publish changes" is pressed. */

'use strict';

const KEY = new URLSearchParams(location.search).get('k') || '';

const FILES = {
  ceramic: 'src/data/ceramic.json',
  luster: 'src/data/luster.json',
  gold: 'src/data/gold.json',
  inglaze: 'src/data/inglaze.json',
  gallery: 'src/data/gallery.json',
  site: 'src/data/site.json',
  ranges: 'src/data/ranges.json',
};

const PRODUCTS = {
  ceramic: {
    title: 'Ceramic & glass colours',
    noun: 'colour',
    code: 'required',
    intro: 'On-glaze and glass colours shown on the Ceramic & Glass Colours page.',
    types: () => [
      ['on-glaze', 'On-glaze (760 to 830°C)'],
      ['glass', 'Glass (500 to 560°C)'],
    ],
  },
  luster: {
    title: 'Lustre colours',
    noun: 'colour',
    code: 'optional',
    intro: 'Lustres shown on the Liquid Lustre Colours page.',
    types: () => [
      ['non-gold', 'Standard lustre'],
      ['gold-based', 'Gold-based lustre'],
      ['medium', 'Medium (oil base)'],
    ],
  },
  gold: {
    title: 'Liquid gold & platinum',
    noun: 'grade',
    purity: true,
    intro: 'Each purity is one entry. Entries with the same name are shown together on the website as one product.',
    types: () => [
      ['gold', 'Gold'],
      ['platinum', 'Platinum'],
    ],
  },
  inglaze: {
    title: 'In-glaze colours',
    noun: 'colour',
    code: 'required',
    intro: 'High-temperature colours. While this list is empty, the website shows a "range being added" page.',
    types: () => [['inglaze', `In-glaze (${S.work[FILES.ranges]?.inglaze?.firing || '1150 to 1250°C'})`]],
  },
};

const SECTIONS = [
  { id: 'ceramic', label: 'Ceramic & glass', group: 'Colours' },
  { id: 'luster', label: 'Lustres' },
  { id: 'gold', label: 'Gold & platinum' },
  { id: 'inglaze', label: 'In-glaze' },
  { id: 'gallery', label: 'Gallery photos', group: 'Photos' },
  { id: 'contact', label: 'Contact details', group: 'Website text' },
  { id: 'ranges', label: 'Range descriptions' },
  { id: 'help', label: 'How to use', group: 'Help' },
];

const STOCK = { in: 'In stock', low: 'Low stock', out: 'On order' };
const GALLERY_CATEGORIES = [
  ['gold', 'Gold & platinum'],
  ['lustre', 'Lustres'],
  ['glass', 'On glass'],
  ['ceramic', 'On ceramic'],
  ['packing', 'Powders & packing'],
];

const S = {
  base: {}, // as loaded from the website, with internal ids
  baseShas: {}, // file versions the current work is based on
  work: {}, // working copies being edited
  seq: 0,
  view: 'ceramic',
  q: '',
  filter: 'all',
  settings: {},
  local: false,
  windows: false,
  stale: false,
};

/* ---------- small helpers ---------- */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = (x) => JSON.parse(JSON.stringify(x));
const strip = (x) => (Array.isArray(x) ? x.map(({ __id, ...rest }) => rest) : x);
const same = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));
const withIds = (content) => (Array.isArray(content) ? content.map((it, i) => ({ ...it, __id: `b${i}` })) : content);

function inkFor(hex) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const lum = 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? '#1c1a17' : '#f7f4ee';
}

function photoUrl(image) {
  if (!image) return '';
  if (image.startsWith('draft:')) return `/photo/draft/${image.slice(6)}?k=${encodeURIComponent(KEY)}`;
  return `/photo/site?path=${encodeURIComponent(image)}&k=${encodeURIComponent(KEY)}`;
}

async function api(path, body, opts = {}) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-SVE-Key': KEY, ...(opts.raw ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : opts.raw ? body : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Try again.');
    err.status = res.status;
    err.conflict = data.conflict;
    throw err;
  }
  return data;
}

function itemLabel(item) {
  if (item.caption !== undefined && item.name === undefined) return item.caption;
  if (item.purity) return `${item.name} ${item.purity}`;
  return item.code ? `${item.code} ${item.name}` : item.name;
}

/* ---------- toast and confirm ---------- */

let toastTimer;
function toast(text, action) {
  const box = $('#toast');
  $('#toastText').textContent = text;
  const btn = $('#toastAction');
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => {
      box.hidden = true;
      action.run();
    };
  }
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), action ? 9000 : 4500);
}

function confirmBox(title, text, yes = 'Yes', danger = false) {
  const dlg = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  const y = $('#confirmYes');
  y.textContent = yes;
  y.className = danger ? 'btn danger' : 'btn primary';
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true }));
}

/* ---------- changes ---------- */

function changes() {
  const out = [];
  for (const [section, path] of Object.entries(FILES)) {
    const base = S.base[path];
    const work = S.work[path];
    if (base === undefined || same(base, work)) continue;
    if (Array.isArray(work)) {
      const where = section === 'gallery' ? 'gallery' : PRODUCTS[section].title.toLowerCase();
      const baseById = new Map(base.map((b) => [b.__id, b]));
      const workIds = new Set(work.map((w) => w.__id));
      for (const w of work) {
        const b = baseById.get(w.__id);
        if (!b) out.push({ path, text: `Add ${itemLabel(w)} (${where})` });
        else if (!same([b], [w])) out.push({ path, text: `Change ${itemLabel(w)} (${where})` });
      }
      for (const b of base) if (!workIds.has(b.__id)) out.push({ path, text: `Remove ${itemLabel(b)} (${where})` });
      const order = (list) => list.filter((x) => workIds.has(x.__id) && baseById.has(x.__id)).map((x) => x.__id).join();
      if (out.filter((c) => c.path === path).length === 0 && order(base) !== order(work)) out.push({ path, text: `Change the order of the ${where}` });
    } else if (section === 'site') {
      out.push({ path, text: 'Change contact details' });
    } else if (section === 'ranges') {
      for (const key of Object.keys(work)) if (!same(base[key], work[key])) out.push({ path, text: `Change the text for ${work[key].title}` });
    }
  }
  return out;
}

const changedFiles = () => Object.values(FILES).filter((p) => S.base[p] !== undefined && !same(S.base[p], S.work[p]));

/* ---------- draft (kept on this computer until published) ---------- */

let draftTimer;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    api('/api/draft', draftBody()).catch(() => {});
  }, 300);
}

// The draft keeps the edited copies plus the version they started from, so the edits can be
// moved onto a newer website if it changes before they are published.
function draftBody() {
  const base = {};
  for (const p of changedFiles()) base[p] = S.base[p];
  return { work: S.work, base, baseShas: S.baseShas, seq: S.seq };
}

function flushDraft() {
  clearTimeout(draftTimer);
  const body = new Blob([JSON.stringify(draftBody())], { type: 'application/json' });
  navigator.sendBeacon(`/api/draft?k=${encodeURIComponent(KEY)}`, body);
}

function changed() {
  saveDraft();
  renderStatus();
  renderSide();
}

/* ---------- loading ---------- */

async function loadAll() {
  $('#status').textContent = 'Loading the website…';
  const r = await api('/api/load', {});
  S.base = {};
  S.baseShas = {};
  for (const [path, f] of Object.entries(r.files)) {
    S.base[path] = withIds(f.content);
    S.baseShas[path] = f.sha;
  }
  if (r.draft && r.draft.work) {
    S.work = r.draft.work;
    S.seq = r.draft.seq || 0;
    const oldShas = r.draft.baseShas || {};
    S.stale = Object.values(FILES).some((p) => oldShas[p] && oldShas[p] !== S.baseShas[p] && !same(S.base[p], S.work[p]));
    if (S.stale) {
      // The website changed since these edits were made: move the edits onto the latest version.
      S.work = rebase({ ...S.base, ...(r.draft.base || {}) }, S.work, S.base);
      S.stale = false;
      toast('The website was updated since you last worked. Your unpublished changes were kept.');
    } else {
      S.baseShas = { ...S.baseShas, ...oldShas };
    }
    for (const p of Object.values(FILES)) if (S.work[p] === undefined) S.work[p] = clone(S.base[p]);
  } else {
    S.work = clone(S.base);
  }
  render();
}

/**
 * Apply "my changes" (from oldBase to work) onto a newer version of the website (newBase).
 * Items are matched by what identifies them on the website: code and name, purity, or the photo.
 */
function rebase(oldBase, work, newBase) {
  const result = {};
  const keyOf = (path, it) => (path === FILES.gallery ? it.image : `${(it.code || '').toLowerCase()}|${(it.name || '').toLowerCase()}|${it.purity || ''}`);
  for (const path of Object.values(FILES)) {
    const nb = clone(newBase[path]);
    const ob = oldBase[path];
    const w = work[path];
    if (w === undefined || ob === undefined || same(ob, w)) {
      result[path] = nb;
      continue;
    }
    if (!Array.isArray(w)) {
      const merged = { ...nb };
      for (const k of Object.keys(w)) if (!same(ob[k], w[k])) merged[k] = w[k];
      result[path] = merged;
      continue;
    }
    const obById = new Map(ob.map((x) => [x.__id, x]));
    const wIds = new Set(w.map((x) => x.__id));
    let list = nb;
    for (const x of ob) if (!wIds.has(x.__id)) list = list.filter((y) => keyOf(path, y) !== keyOf(path, x));
    for (const x of w) {
      const before = obById.get(x.__id);
      if (before && same([before], [x])) continue;
      const k = keyOf(path, before || x);
      const at = list.findIndex((y) => keyOf(path, y) === k);
      const item = { ...x, __id: at >= 0 ? list[at].__id : `n${++S.seq}` };
      if (at >= 0) list[at] = item;
      else list.push(item);
    }
    result[path] = list;
  }
  return result;
}

/* ---------- rendering ---------- */

function render() {
  renderStatus();
  renderSide();
  renderMain();
}

function renderStatus() {
  const n = changes().length;
  const st = $('#status');
  st.classList.toggle('pending', n > 0);
  st.textContent = n
    ? `${n} ${n === 1 ? 'change' : 'changes'} not on the website yet`
    : S.local
      ? 'Test mode: saving to a folder on this computer'
      : 'Everything is on the website';
  $('#publishBtn').disabled = n === 0;
  $('#undoAll').hidden = n === 0;
}

function renderSide() {
  const changedPaths = new Set(changedFiles());
  const html = SECTIONS.map((s) => {
    const group = s.group ? `<p class="side-label">${esc(s.group)}</p>` : '';
    const path = FILES[s.id === 'contact' ? 'site' : s.id];
    const list = Array.isArray(S.work[path]) ? S.work[path] : null;
    const dot = path && changedPaths.has(path) ? '<span class="dot" title="Changed"></span>' : '';
    const count = list ? `<span class="count">${list.length}</span>` : '';
    return `${group}<button class="side-btn" data-view="${s.id}" ${S.view === s.id ? 'aria-current="page"' : ''}><span>${esc(s.label)}</span>${dot}${count}</button>`;
  }).join('');
  $('#side').innerHTML = html;
}

function renderMain() {
  const main = $('#main');
  if (PRODUCTS[S.view]) main.innerHTML = productView(S.view);
  else if (S.view === 'gallery') main.innerHTML = galleryView();
  else if (S.view === 'contact') main.innerHTML = contactView();
  else if (S.view === 'ranges') main.innerHTML = rangesView();
  else main.innerHTML = helpView();
}

function badge(path, item) {
  const base = S.base[path] || [];
  const b = base.find((x) => x.__id === item.__id);
  if (!b) return '<span class="badge new">New</span>';
  if (!same([b], [item])) return '<span class="badge edited">Changed</span>';
  return '';
}

function thumb(item, label) {
  if (item.image) return `<img src="${photoUrl(item.image)}" alt="" loading="lazy" decoding="async">`;
  const hex = item.hex || '#888888';
  return `<div class="swatch" style="background:${esc(hex)};color:${inkFor(hex)}"><span>${esc(label || '')}<br><small>No photo</small></span></div>`;
}

function productView(section) {
  const cfg = PRODUCTS[section];
  const path = FILES[section];
  const all = S.work[path] || [];
  const types = cfg.types();
  const typeName = Object.fromEntries(types);
  const q = S.q.trim().toLowerCase();
  const shown = all.filter(
    (it) => (S.filter === 'all' || it.range === S.filter) && (!q || `${it.name} ${it.code || ''} ${it.purity || ''}`.toLowerCase().includes(q)),
  );
  const filters =
    types.length > 1
      ? `<div class="filters" role="group" aria-label="Show">${[['all', 'All'], ...types]
          .map(([id, label]) => `<button class="filter" data-filter="${id}" aria-pressed="${S.filter === id}">${esc(label)}</button>`)
          .join('')}</div>`
      : '';
  const cards = shown
    .map((it) => {
      const top = cfg.purity ? it.purity : it.code || '';
      return `<li><button class="item" data-edit="${esc(it.__id)}" aria-label="Edit ${esc(itemLabel(it))}">
        ${badge(path, it)}
        <div class="thumb">${thumb(it, top)}</div>
        <div class="item-body">
          ${top ? `<span class="item-code">${esc(top)}</span>` : ''}
          <span class="item-name">${esc(it.name)}</span>
          <span class="item-meta">${esc(typeName[it.range] || '')} <span class="pill ${esc(it.stock)}">${esc(STOCK[it.stock] || '')}</span></span>
        </div>
      </button></li>`;
    })
    .join('');
  const addCard = `<li><button class="add-card" data-action="add"><svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8Z"/></svg>Add a ${esc(cfg.noun)}</button></li>`;
  return `
    <div class="view-head">
      <div><h1>${esc(cfg.title)}</h1><p class="muted">${esc(cfg.intro)} ${all.length} on the list.</p></div>
      <button class="btn primary" data-action="add">Add a ${esc(cfg.noun)}</button>
    </div>
    <div class="toolbar">
      <input type="search" id="search" value="${esc(S.q)}" placeholder="Find by name or code…" aria-label="Find by name or code" autocomplete="off" spellcheck="false">
      ${filters}
    </div>
    ${shown.length || !q ? `<ul class="cards">${q ? '' : addCard}${cards}</ul>` : `<p class="empty">Nothing matches “${esc(S.q)}”.</p>`}`;
}

function galleryView() {
  const path = FILES.gallery;
  const all = S.work[path] || [];
  const cat = Object.fromEntries(GALLERY_CATEGORIES);
  const cards = all
    .map(
      (it, i) => `<li><button class="item" data-edit="${esc(it.__id)}" aria-label="Edit photo ${esc(it.caption)}">
        ${badge(path, it)}
        <div class="thumb">${thumb(it)}</div>
        <div class="item-body"><span class="item-meta">${i + 1}. ${esc(cat[it.category] || '')}</span><span class="item-name">${esc(it.caption)}</span></div>
      </button></li>`,
    )
    .join('');
  return `
    <div class="view-head">
      <div><h1>Gallery photos</h1><p class="muted">Photos on the Gallery page, in this order. ${all.length} photos.</p></div>
      <button class="btn primary" data-action="add">Add a photo</button>
    </div>
    <ul class="cards gallery"><li><button class="add-card" data-action="add"><svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" d="M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8Z"/></svg>Add a photo</button></li>${cards}</ul>`;
}

function contactView() {
  const s = S.work[FILES.site];
  const phone = (i) => (s.phones[i] ? s.phones[i].display : '');
  const f = (name, label, value, attrs = '', help = '') => `
    <label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attrs}>${help ? `<small>${help}</small>` : ''}<span class="field-error" data-error="${name}" hidden></span></label>`;
  return `
    <div class="view-head"><div><h1>Contact details</h1><p class="muted">Shown in the footer and on the Contact page. Changes are kept as you type.</p></div></div>
    <form class="sheet" id="contactForm" novalidate>
      <h2>Phone and WhatsApp</h2>
      <div class="grid-2">
        ${f('phone0', 'Mobile number', phone(0), 'type="tel" autocomplete="off"', 'With +91, for example +91 98971 35970')}
        ${f('phone1', 'Office number', phone(1), 'type="tel" autocomplete="off"', 'Leave empty if there is none')}
      </div>
      ${f('whatsapp', 'WhatsApp number', s.whatsapp, 'type="tel" inputmode="numeric" autocomplete="off"', 'The number customers message from the website, digits only, starting with 91')}
      <h2>Email</h2>
      <div class="grid-2">
        ${f('email0', 'Main email', s.emails[0] || '', 'type="email" autocomplete="off" spellcheck="false"')}
        ${f('email1', 'Second email', s.emails[1] || '', 'type="email" autocomplete="off" spellcheck="false"', 'Leave empty if there is none')}
      </div>
      <h2>Opening hours and address</h2>
      ${f('hours', 'Opening hours', s.hours)}
      ${f('line1', 'Address, line 1', s.address.line1)}
      <div class="grid-2">
        ${f('line2', 'Address, line 2', s.address.line2)}
        ${f('region', 'State and PIN code', s.address.region)}
      </div>
      ${f('country', 'Country', s.address.country)}
    </form>`;
}

function rangesView() {
  const r = S.work[FILES.ranges];
  const order = ['gold', 'luster', 'ceramic', 'inglaze'];
  return `
    <div class="view-head"><div><h1>Range descriptions</h1><p class="muted">The words and temperatures for each product range. Changes are kept as you type.</p></div></div>
    ${order
      .map((k) => {
        const x = r[k];
        return `<form class="sheet" data-range="${k}" novalidate>
          <h2>${esc(x.title)}</h2>
          <label class="field"><span>Name of the range</span><input name="title" value="${esc(x.title)}"></label>
          <div class="grid-2">
            <label class="field"><span>Lowest firing temperature (°C)</span><input name="min" type="number" inputmode="numeric" value="${esc(x.min)}"></label>
            <label class="field"><span>Highest firing temperature (°C)</span><input name="max" type="number" inputmode="numeric" value="${esc(x.max)}"></label>
          </div>
          <span class="field-error" data-error="temps" hidden></span>
          <label class="field"><span>Short description</span><textarea name="summary" rows="3">${esc(x.summary)}</textarea></label>
          <label class="field"><span>Points on the Products page</span><textarea name="points" rows="3">${esc(x.points.join('\n'))}</textarea><small>One point per line</small></label>
          <label class="field"><span>Notes at the top of the range page</span><textarea name="notes" rows="3">${esc(x.notes.join('\n'))}</textarea><small>One note per line. Can be empty.</small></label>
        </form>`;
      })
      .join('')}`;
}

function helpView() {
  return `
    <div class="view-head"><div><h1>How to use the editor</h1></div></div>
    <div class="sheet">
      <h2>Add a colour</h2>
      <ol class="steps">
        <li>Choose the range on the left, for example <strong>Ceramic & glass</strong>.</li>
        <li>Press <strong>Add a colour</strong>. Fill in the name and code, choose the type and stock.</li>
        <li>Press <strong>Choose photo</strong>, or drag a photo onto the dotted box. A clear daylight photo on white paper works best.</li>
        <li>Press <strong>Save</strong>. The colour shows on the list with a green <strong>New</strong> label.</li>
      </ol>
      <h2>Put changes on the website</h2>
      <ol class="steps">
        <li>Press <strong>Publish changes</strong> at the top right. You will see a list of everything that changed.</li>
        <li>Press <strong>Publish now</strong>. The website updates in about 2 minutes.</li>
      </ol>
      <h2>Good to know</h2>
      <ul class="steps">
        <li>You can close the editor at any time. Changes that are not published yet are kept for next time.</li>
        <li>Made a mistake? Open the item and change it, or press <strong>Undo all changes</strong> before publishing.</li>
        <li>Colours without a photo show as a coloured tile with the code, labelled "screen colour only".</li>
        <li>If something says it could not reach GitHub, check the internet and try again.</li>
      </ul>
    </div>`;
}

/* ---------- item panel (add / edit) ---------- */

let panelState = null; // { section, path, id, item, dirty }

function blankItem(section) {
  if (section === 'gallery') return { image: null, caption: '', category: 'ceramic' };
  const cfg = PRODUCTS[section];
  const item = { name: '', hex: '#888888', image: null, stock: 'in', range: cfg.types()[0][0] };
  if (cfg.code) item.code = '';
  if (cfg.purity) item.purity = '';
  return item;
}

function openPanel(section, id) {
  const path = FILES[section];
  const list = S.work[path];
  const existing = id ? list.find((x) => x.__id === id) : null;
  const item = existing ? clone(existing) : blankItem(section);
  panelState = { section, path, id: existing ? id : null, item, dirty: false, hexTouched: !!existing, pos: existing ? list.indexOf(existing) : 0 };
  const dlg = $('#panel');
  dlg.innerHTML = section === 'gallery' ? galleryForm() : productForm();
  dlg.showModal();
  wirePanel();
  const first = dlg.querySelector(section === 'gallery' ? 'textarea, input[name=caption]' : 'input[name=name]');
  first?.focus();
}

function photoBlock() {
  const it = panelState.item;
  return `<div class="photo-field" id="photoField">
      <div class="thumb" id="photoPreview">${thumb(it, it.code || it.purity || '')}</div>
      <div class="photo-actions">
        <span class="legend">Photo</span>
        <label class="btn"><input type="file" id="photoInput" accept="image/jpeg,image/png,image/webp" hidden>Choose photo…</label>
        <span class="help">or drag a photo onto this box</span>
        ${it.image && panelState.section !== 'gallery' ? '<button type="button" class="link" id="removePhoto">Remove photo</button>' : ''}
        <span class="help" id="photoStatus" role="status"></span>
      </div>
    </div>`;
}

function productForm() {
  const { section, item, id } = panelState;
  const cfg = PRODUCTS[section];
  const names = [...new Set((S.work[FILES.gold] || []).map((x) => x.name))];
  return `<form method="dialog" id="itemForm" novalidate>
    <div class="panel-head"><h2 id="panelTitle">${id ? 'Edit' : 'Add a'} ${esc(cfg.noun)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="panel-body">
      ${photoBlock()}
      <label class="field"><span>Name</span><input name="name" value="${esc(item.name)}" maxlength="60" autocomplete="off" ${cfg.purity ? 'list="goldNames"' : ''}>
        ${cfg.purity ? `<datalist id="goldNames">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist><small>Use the same name for every purity of one product</small>` : ''}
        <span class="field-error" data-error="name" hidden></span></label>
      ${
        cfg.code
          ? `<label class="field"><span>Code${cfg.code === 'optional' ? ' (if it has one)' : ''}</span><input name="code" value="${esc(item.code || '')}" maxlength="20" autocomplete="off" spellcheck="false"><span class="field-error" data-error="code" hidden></span></label>`
          : ''
      }
      ${
        cfg.purity
          ? `<label class="field"><span>Purity</span><input name="purity" value="${esc(item.purity || '')}" list="purities" maxlength="20" autocomplete="off"><datalist id="purities"><option value="7%"><option value="10%"><option value="12%"><option value="Custom"></datalist><small>For example 10% or Custom</small><span class="field-error" data-error="purity" hidden></span></label>`
          : ''
      }
      <fieldset class="choices"><legend class="legend">Type</legend>
        ${cfg
          .types()
          .map(([v, l]) => `<label class="choice"><input type="radio" name="range" value="${v}" ${item.range === v ? 'checked' : ''}><span>${esc(l)}</span></label>`)
          .join('')}
      </fieldset>
      <fieldset class="choices"><legend class="legend">Stock</legend>
        ${Object.entries(STOCK)
          .map(([v, l]) => `<label class="choice"><input type="radio" name="stock" value="${v}" ${item.stock === v ? 'checked' : ''}><span>${l}</span></label>`)
          .join('')}
      </fieldset>
      <label class="field"><span>Swatch colour</span>
        <span class="colour-row"><input type="color" name="hex" value="${esc(item.hex || '#888888')}"><span class="help">Shown as a small dot, and as the tile when there is no photo. Filled in from the photo; change it if it looks wrong.</span></span>
      </label>
      <p class="form-error" id="formError" role="alert" hidden></p>
    </div>
    <div class="panel-foot">
      ${id ? '<button type="button" class="btn danger" id="deleteItem">Delete</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>`;
}

function galleryForm() {
  const { item, id, path } = panelState;
  const n = S.work[path].length + (id ? 0 : 1);
  return `<form method="dialog" id="itemForm" novalidate>
    <div class="panel-head"><h2 id="panelTitle">${id ? 'Edit photo' : 'Add a photo'}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="panel-body">
      ${photoBlock()}
      <span class="field-error" data-error="image" hidden></span>
      <label class="field"><span>Caption</span><input name="caption" value="${esc(item.caption)}" maxlength="80" autocomplete="off"><small>A few words, for example "Gold rims on tea cups"</small><span class="field-error" data-error="caption" hidden></span></label>
      <fieldset class="choices"><legend class="legend">Category</legend>
        ${GALLERY_CATEGORIES.map(([v, l]) => `<label class="choice"><input type="radio" name="category" value="${v}" ${item.category === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </fieldset>
      <label class="field"><span>Position in the gallery</span>
        <select name="pos">${Array.from({ length: n }, (_, i) => `<option value="${i}" ${panelState.pos === i ? 'selected' : ''}>${i === 0 ? '1 (first)' : i === n - 1 ? `${i + 1} (last)` : i + 1}</option>`).join('')}</select>
      </label>
      <p class="form-error" id="formError" role="alert" hidden></p>
    </div>
    <div class="panel-foot">
      ${id ? '<button type="button" class="btn danger" id="deleteItem">Delete</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>`;
}

function refreshPreview() {
  const it = panelState.item;
  $('#photoPreview').innerHTML = thumb(it, it.code || it.purity || '');
}

async function uploadPhoto(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    $('#photoStatus').textContent = 'Choose a JPG or PNG photo.';
    return;
  }
  $('#photoStatus').textContent = 'Preparing photo…';
  try {
    const r = await api('/api/photo', file, { raw: true });
    panelState.item.image = `draft:${r.id}`;
    panelState.dirty = true;
    if (!panelState.hexTouched) {
      panelState.item.hex = r.hex;
      const input = $('#itemForm input[name=hex]');
      if (input) input.value = r.hex.toLowerCase();
    }
    refreshPreview();
    $('#photoStatus').textContent = 'Photo ready.';
  } catch (e) {
    $('#photoStatus').textContent = e.message;
  }
}

function wirePanel() {
  const form = $('#itemForm');
  form.addEventListener('input', (e) => {
    panelState.dirty = true;
    if (e.target.name === 'hex') panelState.hexTouched = true;
    if (e.target.name === 'hex' || e.target.name === 'code' || e.target.name === 'purity') {
      if (e.target.name === 'hex') panelState.item.hex = e.target.value;
      if (!panelState.item.image) {
        panelState.item[e.target.name] = e.target.value;
        refreshPreview();
      }
    }
  });
  $('#photoInput').addEventListener('change', (e) => uploadPhoto(e.target.files[0]));
  const field = $('#photoField');
  field.addEventListener('dragover', (e) => {
    e.preventDefault();
    field.classList.add('drag');
  });
  field.addEventListener('dragleave', () => field.classList.remove('drag'));
  field.addEventListener('drop', (e) => {
    e.preventDefault();
    field.classList.remove('drag');
    uploadPhoto(e.dataTransfer.files[0]);
  });
  $('#removePhoto')?.addEventListener('click', () => {
    panelState.item.image = null;
    panelState.dirty = true;
    refreshPreview();
    $('#removePhoto').remove();
  });
  form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanel));
  $('#deleteItem')?.addEventListener('click', deleteItem);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveItem();
  });
}

async function closePanel() {
  if (panelState?.dirty && !(await confirmBox('Leave without saving?', 'The changes in this form will be lost.', 'Leave without saving', true))) return;
  $('#panel').close();
  panelState = null;
}

function showErrors(errors) {
  const form = $('#itemForm');
  form.querySelectorAll('[data-error]').forEach((el) => (el.hidden = true));
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  for (const [name, msg] of Object.entries(errors)) {
    const el = form.querySelector(`[data-error="${name}"]`);
    if (el) {
      el.textContent = msg;
      el.hidden = false;
    }
    form.querySelector(`[name="${name}"]`)?.setAttribute('aria-invalid', 'true');
  }
  const firstName = Object.keys(errors)[0];
  form.querySelector(`[name="${firstName}"]`)?.focus();
}

function saveItem() {
  const { section, path, id } = panelState;
  const form = $('#itemForm');
  const data = Object.fromEntries(new FormData(form));
  const it = panelState.item;
  const list = S.work[path];
  const errors = {};
  let item;
  if (section === 'gallery') {
    if (!it.image) errors.image = 'Choose a photo.';
    if (!data.caption?.trim()) errors.caption = 'Write a short caption.';
    item = { image: it.image, caption: (data.caption || '').trim(), category: data.category || 'ceramic' };
  } else {
    const cfg = PRODUCTS[section];
    const name = (data.name || '').trim();
    const code = (data.code || '').trim();
    const purity = (data.purity || '').trim();
    if (!name) errors.name = 'Write the name of the colour.';
    if (cfg.code === 'required' && !code) errors.code = 'Write the code.';
    if (cfg.purity && !purity) errors.purity = 'Write the purity, for example 10%.';
    const dup = list.find(
      (x) =>
        x.__id !== id &&
        ((cfg.code && code && (x.code || '').toLowerCase() === code.toLowerCase()) ||
          (cfg.purity && x.name.toLowerCase() === name.toLowerCase() && (x.purity || '').toLowerCase() === purity.toLowerCase()) ||
          (cfg.code === 'optional' && !code && x.name.toLowerCase() === name.toLowerCase())),
    );
    if (dup) {
      if (cfg.purity) errors.purity = `${dup.name} ${dup.purity} is already on the list.`;
      else if (code) errors.code = `Code ${code} is already used by ${dup.name}.`;
      else errors.name = `${dup.name} is already on the list.`;
    }
    item = { name };
    if (cfg.code === 'required' || code) item.code = code;
    if (cfg.purity) item.purity = purity;
    item.hex = (data.hex || it.hex || '#888888').toUpperCase();
    item.image = it.image || null;
    item.stock = data.stock || 'in';
    item.range = data.range || cfg.types()[0][0];
  }
  if (Object.keys(errors).length) return showErrors(errors);

  if (id) {
    const at = list.findIndex((x) => x.__id === id);
    item.__id = id;
    list[at] = item;
    if (section === 'gallery') {
      list.splice(at, 1);
      list.splice(Number(data.pos ?? at), 0, item);
    }
  } else {
    item.__id = `n${++S.seq}`;
    if (section === 'gallery') list.splice(Number(data.pos ?? 0), 0, item);
    else list.unshift(item);
  }
  $('#panel').close();
  panelState = null;
  changed();
  renderMain();
  toast(`${id ? 'Saved' : 'Added'} ${itemLabel(item)}. Press "Publish changes" to put it on the website.`);
}

async function deleteItem() {
  const { path, id } = panelState;
  const list = S.work[path];
  const at = list.findIndex((x) => x.__id === id);
  const item = list[at];
  if (!(await confirmBox(`Delete ${itemLabel(item)}?`, 'It will be removed from the website when you publish.', 'Delete', true))) return;
  list.splice(at, 1);
  $('#panel').close();
  panelState = null;
  changed();
  renderMain();
  toast(`Deleted ${itemLabel(item)}.`, {
    label: 'Undo',
    run: () => {
      list.splice(at, 0, item);
      changed();
      renderMain();
    },
  });
}

/* ---------- text forms ---------- */

function onContactInput(e) {
  const s = S.work[FILES.site];
  const { name, value } = e.target;
  const err = (msg) => {
    const el = $(`[data-error="${name}"]`);
    el.textContent = msg || '';
    el.hidden = !msg;
    e.target.toggleAttribute('aria-invalid', !!msg);
  };
  const toTel = (display) => {
    let d = display.replace(/\D/g, '');
    if (d.length === 10) d = '91' + d;
    return '+' + d;
  };
  if (name === 'phone0' || name === 'phone1') {
    const i = Number(name.slice(-1));
    const label = i === 0 ? 'Mobile' : 'Office';
    const digits = value.replace(/\D/g, '');
    if (!value.trim() && i === 1) {
      s.phones = s.phones.slice(0, 1);
      err('');
    } else if (digits.length < 10 || digits.length > 15) {
      return err('Write the full number, for example +91 98971 35970.');
    } else {
      s.phones[i] = { label, display: value.trim(), tel: toTel(value) };
      err('');
    }
  } else if (name === 'whatsapp') {
    let d = value.replace(/\D/g, '');
    if (d.length === 10) d = '91' + d;
    if (d.length < 11 || d.length > 15) return err('Write the number with 91 at the start, for example 919897135970.');
    s.whatsapp = d;
    err('');
  } else if (name === 'email0' || name === 'email1') {
    const i = Number(name.slice(-1));
    const v = value.trim();
    if (!v && i === 1) {
      s.emails = s.emails.slice(0, 1);
      err('');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return err('That does not look like an email address.');
    } else {
      s.emails[i] = v;
      err('');
    }
  } else if (name === 'hours') {
    s.hours = value;
  } else {
    s.address[name] = value;
  }
  changed();
}

function onRangeInput(e) {
  const form = e.target.closest('[data-range]');
  const r = S.work[FILES.ranges][form.dataset.range];
  const { name, value } = e.target;
  if (name === 'min' || name === 'max') {
    const n = parseInt(value, 10);
    const errEl = form.querySelector('[data-error="temps"]');
    const min = name === 'min' ? n : r.min;
    const max = name === 'max' ? n : r.max;
    if (!Number.isFinite(n) || n < 100 || n > 2000 || min >= max) {
      errEl.textContent = 'Use numbers in °C, with the lowest below the highest.';
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    r[name] = n;
    // Keep the written firing range in step with the numbers.
    r.firing = `${r.min} to ${r.max}°C`;
  } else if (name === 'points' || name === 'notes') {
    r[name] = value
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  } else {
    r[name] = value;
  }
  changed();
}

/* ---------- publishing ---------- */

let pollTimer;
function publishDialog(html) {
  const dlg = $('#publishDialog');
  dlg.innerHTML = `<div class="modal-body">${html}</div>`;
  if (!dlg.open) dlg.showModal();
  return dlg;
}

function openPublish() {
  const list = changes();
  if (!list.length) return;
  const photos = Object.values(FILES).reduce((n, p) => n + (Array.isArray(S.work[p]) ? S.work[p].filter((x) => x.image?.startsWith('draft:')).length : 0), 0);
  const dlg = publishDialog(`
    <h2 id="publishTitle">Put these changes on the website?</h2>
    <ul class="change-list">${list.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>
    <p class="muted">${photos ? `${photos} new ${photos === 1 ? 'photo' : 'photos'} will be uploaded. ` : ''}The website updates about 2 minutes after you publish.</p>
    <div class="modal-actions"><button class="btn" id="pubCancel">Not yet</button><button class="btn primary big" id="pubGo">Publish now</button></div>`);
  $('#pubCancel', dlg).onclick = () => dlg.close();
  $('#pubGo', dlg).onclick = () => doPublish(list);
}

async function doPublish(list) {
  publishDialog(`<h2 id="publishTitle">Publishing…</h2><p class="progress"><span class="spinner" aria-hidden="true"></span>Sending your changes. Do not close the editor.</p>`);
  const files = {};
  const baseShas = {};
  for (const p of changedFiles()) {
    files[p] = strip(S.work[p]);
    baseShas[p] = S.baseShas[p];
  }
  const message = `Website update from the editor\n\n${list.map((c) => `- ${c.text}`).join('\n')}`;
  try {
    const r = await api('/api/publish', { files, baseShas, message });
    await loadAll();
    published(r.sha);
  } catch (e) {
    const dlg = publishDialog(`
      <div class="result"><span class="result-icon bad" aria-hidden="true">!</span><div><h2 id="publishTitle">Not published</h2><p>${esc(e.message)}</p><p class="muted">Your changes are still saved in the editor.</p></div></div>
      <div class="modal-actions">${e.status === 409 ? '<button class="btn primary" id="pubRebase">Get latest and keep my changes</button>' : ''}<button class="btn" id="pubClose">Close</button></div>`);
    $('#pubClose', dlg).onclick = () => dlg.close();
    $('#pubRebase', dlg)?.addEventListener('click', async () => {
      const oldBase = S.base;
      const work = S.work;
      const r = await api('/api/load', {});
      const newBase = {};
      for (const [path, f] of Object.entries(r.files)) {
        newBase[path] = withIds(f.content);
        S.baseShas[path] = f.sha;
      }
      S.work = rebase(oldBase, work, newBase);
      S.base = newBase;
      saveDraft();
      render();
      dlg.close();
      toast('Got the latest website. Your changes are kept; check them and publish again.');
    });
  }
}

function published(sha) {
  const site = S.settings.site_url;
  const dlg = publishDialog(`
    <div class="result"><span class="result-icon ok" aria-hidden="true">✓</span><div><h2 id="publishTitle">Published</h2>
    <p id="deployText">${S.local ? 'Saved to the website folder on this computer.' : 'The website is updating. This usually takes about 2 minutes.'}</p></div></div>
    <div class="modal-actions">${S.local ? '' : '<button class="btn" id="openSite">Open the website</button>'}<button class="btn primary" id="pubDone">Done</button></div>`);
  $('#pubDone', dlg).onclick = () => dlg.close();
  $('#openSite', dlg)?.addEventListener('click', () => api('/api/open', { url: site }).catch(() => {}));
  if (S.local || !sha) return;
  let tries = 0;
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    tries++;
    let st = 'unknown';
    try {
      st = (await api(`/api/deploy?sha=${encodeURIComponent(sha)}`)).status;
    } catch {}
    const text = $('#deployText');
    if (!text) return clearInterval(pollTimer);
    if (st === 'success') {
      text.textContent = 'Done: your changes are now on the website.';
      clearInterval(pollTimer);
    } else if (st === 'failure') {
      text.textContent = 'The website could not be updated with these changes. They are saved; tell Kartik so he can look.';
      clearInterval(pollTimer);
    } else if (tries > 36) {
      text.textContent = 'This is taking longer than usual. Check the website in a few minutes.';
      clearInterval(pollTimer);
    }
  }, 10000);
}

/* ---------- setup ---------- */

function showSetup(firstTime) {
  $('#app').hidden = true;
  $('#setup').hidden = false;
  const f = $('#setupForm');
  f.repo.value = S.settings.repo || '';
  f.branch.value = S.settings.branch || '';
  f.site_url.value = S.settings.site_url || '';
  f.token.value = '';
  f.token.placeholder = firstTime ? 'github_pat_…' : 'Saved. Leave empty to keep it.';
  $('#shortcutRow').hidden = !(S.windows && firstTime);
  $('#setupBack').hidden = firstTime;
  $('#setupForget').hidden = firstTime;
  $('#setupError').hidden = true;
  f.token.focus();
}

async function submitSetup(e) {
  e.preventDefault();
  const f = $('#setupForm');
  const err = $('#setupError');
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  err.hidden = true;
  try {
    const st = await api('/api/setup', { token: f.token.value, repo: f.repo.value, branch: f.branch.value, site_url: f.site_url.value });
    S.settings = st.settings;
    if (!$('#shortcutRow').hidden && f.shortcut.checked) await api('/api/shortcut', {}).catch(() => {});
    $('#setup').hidden = true;
    $('#app').hidden = false;
    await loadAll();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check and save';
  }
}

/* ---------- start ---------- */

function wire() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-open]');
    if (!t) return;
    if (t.dataset.view) {
      S.view = t.dataset.view;
      S.q = '';
      S.filter = 'all';
      renderSide();
      renderMain();
      $('#main').focus();
    } else if (t.dataset.filter) {
      S.filter = t.dataset.filter;
      renderMain();
    } else if (t.dataset.edit) {
      openPanel(S.view, t.dataset.edit);
    } else if (t.dataset.action === 'add') {
      openPanel(S.view, null);
    } else if (t.dataset.open) {
      api('/api/open', { url: t.dataset.open }).catch((ex) => toast(ex.message));
    }
  });
  $('#main').addEventListener('input', (e) => {
    if (e.target.id === 'search') {
      S.q = e.target.value;
      const pos = e.target.selectionStart;
      renderMain();
      const s = $('#search');
      s.focus();
      s.setSelectionRange(pos, pos);
    } else if (e.target.closest('#contactForm')) onContactInput(e);
    else if (e.target.closest('[data-range]')) onRangeInput(e);
  });
  $('#panel').addEventListener('cancel', (e) => {
    e.preventDefault();
    closePanel();
  });
  $('#publishBtn').addEventListener('click', openPublish);
  $('#undoAll').addEventListener('click', async () => {
    if (!(await confirmBox('Undo all changes?', 'Everything you changed since the last publish will be thrown away.', 'Undo all', true))) return;
    S.work = clone(S.base);
    await api('/api/discard', {}).catch(() => {});
    render();
    toast('All changes undone.');
  });
  $('#settingsBtn').addEventListener('click', async () => {
    if (S.local) return toast('Test mode has no settings.');
    if (await confirmBox('Open settings?', 'Settings are for Kartik. Your changes are kept.', 'Open settings')) showSetup(false);
  });
  $('#setupForm').addEventListener('submit', submitSetup);
  $('#setupBack').addEventListener('click', () => {
    $('#setup').hidden = true;
    $('#app').hidden = false;
  });
  $('#setupForget').addEventListener('click', async () => {
    if (!(await confirmBox('Remove the key?', 'The editor will need to be set up again before it can publish.', 'Remove', true))) return;
    const st = await api('/api/forget', {});
    S.settings = st.settings;
    showSetup(true);
  });
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushDraft());
  setInterval(() => api('/api/heartbeat', {}).catch(() => {}), 20000);
}

async function start() {
  wire();
  try {
    const st = await api('/api/state');
    S.settings = st.settings;
    S.local = st.local;
    S.windows = st.windows;
    if (!st.configured) return showSetup(true);
    $('#app').hidden = false;
    await loadAll();
  } catch (e) {
    $('#app').hidden = false;
    $('#main').innerHTML = `<div class="sheet"><h1>Could not open the website</h1><p>${esc(e.message)}</p><p><button class="btn primary" onclick="location.reload()">Try again</button></p></div>`;
    $('#status').textContent = '';
  }
}

start();
