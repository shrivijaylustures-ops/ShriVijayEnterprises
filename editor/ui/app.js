/* SVE Website Editor: the editor's screens. Runs as an app window on Windows, as the Android app, or in any browser.
   All website data is loaded once, edited here, kept as a draft on this device, and sent to the
   website in one go when "Publish changes" is pressed. backend.js does the talking to GitHub. */

'use strict';

const FILES = {
  categories: 'src/data/categories.json',
  gallery: 'src/data/gallery.json',
  site: 'src/data/site.json',
};
// Each product category keeps its products in src/data/<id>.json.
const productPath = (id) => `src/data/${id}.json`;
const cats = () => S.work[FILES.categories] || { groups: [], categories: {} };
const catIds = () => cats().groups.flatMap((g) => g.categories);
// Every file the editor works on: the fixed ones plus one per category (including ones added but not yet published).
const allPaths = () => [...new Set([...Object.values(FILES), ...Object.keys(S.work).filter((p) => !Object.values(FILES).includes(p))])];

const temps = (min, max) => (Number.isInteger(min) && Number.isInteger(max) ? `${min} to ${max}°C` : '');

/** How one category's products are edited, from its settings in categories.json. */
function cfgOf(id) {
  const c = cats().categories[id];
  if (!c) return null;
  const grades = c.layout === 'grades';
  const types = c.types.length ? c.types.map((t) => [t.id, [t.label, t.note || temps(t.min, t.max)].filter(Boolean).join(', ')]) : [[id, c.short]];
  return {
    id,
    title: c.title,
    noun: grades ? 'grade' : 'colour',
    code: grades ? null : c.code || 'optional',
    purity: grades,
    intro: grades
      ? 'Each purity is one entry. Entries with the same name are shown together on the website as one product.'
      : `Shown on the ${c.title} page.${(S.work[productPath(id)] || []).length ? '' : ' While this list is empty, the website shows a "range being added" page.'}`,
    types: () => types,
  };
}

// The menu on the left: one entry per category under its group, then the fixed sections.
function sections() {
  const out = [];
  for (const g of cats().groups) g.categories.forEach((id, i) => out.push({ id, label: cats().categories[id]?.short || id, group: i === 0 ? g.title : null, path: productPath(id) }));
  out.push({ id: 'gallery', label: 'Gallery photos', group: 'Photos', path: FILES.gallery });
  out.push({ id: 'contact', label: 'Contact details', group: 'Website text', path: FILES.site });
  out.push({ id: 'categories', label: 'Categories and groups', group: 'Set up', path: FILES.categories });
  out.push({ id: 'help', label: 'How to use', group: 'Help' });
  return out;
}

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
  practice: false,
  q: '',
  filter: 'all',
  settings: {},
  local: false,
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

const finePointer = () => matchMedia('(pointer: fine)').matches;
const photoUrl = (image) => Backend.photoUrl(image);
const api = (path, body) => Backend.call(path, body);

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
  for (const path of allPaths()) {
    const base = S.base[path];
    const work = S.work[path];
    if (base === undefined || work === undefined || same(base, work)) continue;
    if (Array.isArray(work)) {
      const id = path.slice(9, -5);
      const where = path === FILES.gallery ? 'gallery' : (cats().categories[id]?.title || id).toLowerCase();
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
    } else if (path === FILES.site) {
      out.push({ path, text: 'Change contact details' });
    } else if (path === FILES.categories) {
      const b = base.categories || {};
      const w = work.categories || {};
      for (const id of Object.keys(w)) {
        if (!b[id]) out.push({ path, text: `Add the category ${w[id].title}` });
        else if (!same(b[id], w[id])) out.push({ path, text: `Change the category ${w[id].title}` });
      }
      for (const id of Object.keys(b)) if (!w[id]) out.push({ path, text: `Remove the category ${b[id].title}` });
      if (!same(base.groups, work.groups)) out.push({ path, text: 'Change the groups or the order of categories' });
    }
  }
  return out;
}

const changedFiles = () => allPaths().filter((p) => S.base[p] !== undefined && S.work[p] !== undefined && !same(S.base[p], S.work[p]));

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
  if (S.work[FILES.categories]) Backend.saveDraftNow(draftBody());
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
    S.stale = Object.keys(S.base).some((p) => oldShas[p] && oldShas[p] !== S.baseShas[p] && !same(S.base[p], S.work[p]));
    if (S.stale) {
      // The website changed since these edits were made: move the edits onto the latest version.
      S.work = rebase({ ...S.base, ...(r.draft.base || {}) }, S.work, S.base);
      S.stale = false;
      toast('The website was updated since you last worked. Your unpublished changes were kept.');
    } else {
      S.baseShas = { ...S.baseShas, ...oldShas };
    }
    for (const p of Object.keys(S.base)) if (S.work[p] === undefined) S.work[p] = clone(S.base[p]);
    // Categories added in the draft but not yet published start from an empty list.
    for (const id of catIds()) if (S.base[productPath(id)] === undefined) S.base[productPath(id)] = [];
  } else {
    S.work = clone(S.base);
  }
  if (!sections().some((x) => x.id === S.view)) S.view = catIds()[0] || 'help';
  render();
}

/**
 * Apply "my changes" (from oldBase to work) onto a newer version of the website (newBase).
 * Items are matched by what identifies them on the website: code and name, purity, or the photo.
 */
function rebase(oldBase, work, newBase) {
  const result = {};
  const keyOf = (path, it) => (path === FILES.gallery ? it.image : `${(it.code || '').toLowerCase()}|${(it.name || '').toLowerCase()}|${it.purity || ''}`);
  for (const path of new Set([...Object.keys(newBase), ...Object.keys(work)])) {
    const nb = clone(newBase[path]);
    const ob = oldBase[path];
    const w = work[path];
    if (w === undefined || ob === undefined || same(ob, w)) {
      result[path] = nb ?? w;
      continue;
    }
    if (nb === undefined) {
      result[path] = w;
      continue;
    }
    if (path === FILES.categories) {
      // Merge category by category; the group layout is taken from my changes if I changed it.
      const merged = clone(nb);
      for (const id of new Set([...Object.keys(ob.categories), ...Object.keys(w.categories)])) {
        if (same(ob.categories[id], w.categories[id])) continue;
        if (w.categories[id]) merged.categories[id] = w.categories[id];
        else delete merged.categories[id];
      }
      if (!same(ob.groups, w.groups)) merged.groups = w.groups;
      const listed = new Set(merged.groups.flatMap((g) => g.categories));
      for (const g of merged.groups) g.categories = g.categories.filter((id) => merged.categories[id]);
      for (const id of Object.keys(merged.categories)) if (!listed.has(id)) merged.groups.at(-1)?.categories.push(id);
      result[path] = merged;
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
    : S.practice
      ? 'Practice mode: nothing you do here changes the website'
      : 'Everything is on the website';
  $('#publishBtn').disabled = n === 0;
  $('#publishCount').textContent = n ? String(n) : '';
  $('#undoAll').hidden = n === 0;
}

function renderSide() {
  const changedPaths = new Set(changedFiles());
  const all = sections();
  const html = all.map((s) => {
    const group = s.group ? `<p class="side-label">${esc(s.group)}</p>` : '';
    const path = s.path;
    const list = Array.isArray(S.work[path]) ? S.work[path] : null;
    const dot = path && changedPaths.has(path) ? '<span class="dot" title="Changed"></span>' : '';
    const count = list ? `<span class="count">${list.length}</span>` : '';
    return `${group}<button class="side-btn" data-view="${s.id}" ${S.view === s.id ? 'aria-current="page"' : ''}><span>${esc(s.label)}</span>${dot}${count}</button>`;
  }).join('');
  $('#side').innerHTML = html;
  $('#sideToggleLabel').textContent = all.find((x) => x.id === S.view)?.label || 'Menu';
}

function renderMain() {
  const main = $('#main');
  if (cfgOf(S.view)) main.innerHTML = productView(S.view);
  else if (S.view === 'gallery') main.innerHTML = galleryView();
  else if (S.view === 'contact') main.innerHTML = contactView();
  else if (S.view === 'categories') main.innerHTML = categoriesView();
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
  const cfg = cfgOf(section);
  const path = productPath(section);
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
      <div class="view-title"><h1>${esc(cfg.title)}</h1><p class="muted">${esc(cfg.intro)} ${all.length} on the list.</p></div>
      <div class="view-actions">
        <button class="btn" data-edit-cat="${esc(section)}">Category details</button>
        <button class="btn primary" data-action="add">Add a ${esc(cfg.noun)}</button>
      </div>
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

/* ---------- categories and groups ---------- */

function catBadge(id) {
  const b = S.base[FILES.categories]?.categories?.[id];
  const w = cats().categories[id];
  if (!b) return '<span class="badge new">New</span>';
  if (!same(b, w)) return '<span class="badge edited">Changed</span>';
  return '';
}

function categoriesView() {
  const c = cats();
  const order = catIds();
  const groups = c.groups
    .map((g, gi) => {
      const rows = g.categories
        .map((id) => {
          const cat = c.categories[id];
          const n = (S.work[productPath(id)] || []).length;
          const at = order.indexOf(id);
          const meta = [
            temps(cat.min, cat.max) || 'No firing temperature yet',
            `${n} ${cat.layout === 'grades' ? (n === 1 ? 'grade' : 'grades') : n === 1 ? 'colour' : 'colours'}`,
            cat.hidden ? 'Hidden from the website' : '',
          ].filter(Boolean);
          return `<li class="cat-row${cat.hidden ? ' is-hidden' : ''}">
            <div class="cat-main">
              <span class="cat-title">${esc(cat.title)} ${catBadge(id)}</span>
              <span class="cat-meta">In the menu: <strong>${esc(cat.short)}</strong></span>
              <span class="cat-meta">${meta.map(esc).join(' · ')}</span>
            </div>
            <div class="cat-actions">
              <button class="icon-btn" data-cat-action="up" data-id="${esc(id)}" aria-label="Move ${esc(cat.short)} up" title="Move up" ${at === 0 ? 'disabled' : ''}>↑</button>
              <button class="icon-btn" data-cat-action="down" data-id="${esc(id)}" aria-label="Move ${esc(cat.short)} down" title="Move down" ${at === order.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn" data-edit-cat="${esc(id)}">Edit</button>
            </div>
          </li>`;
        })
        .join('');
      return `<section class="sheet group-card" aria-labelledby="grp-${esc(g.id)}">
        <div class="group-head">
          <div class="group-name"><span class="side-label">Group ${gi + 1}</span><h2 id="grp-${esc(g.id)}">${esc(g.title)}</h2></div>
          <div class="cat-actions">
            <button class="icon-btn" data-cat-action="group-up" data-id="${esc(g.id)}" aria-label="Move the group ${esc(g.title)} up" title="Move group up" ${gi === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn" data-cat-action="group-down" data-id="${esc(g.id)}" aria-label="Move the group ${esc(g.title)} down" title="Move group down" ${gi === c.groups.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn" data-cat-action="rename-group" data-id="${esc(g.id)}">Rename</button>
            ${g.categories.length ? '' : `<button class="btn danger-text" data-cat-action="delete-group" data-id="${esc(g.id)}">Delete group</button>`}
          </div>
        </div>
        ${rows ? `<ul class="cat-list">${rows}</ul>` : '<p class="muted">This group is empty. Open a category with <strong>Edit</strong> and choose this group, or add a new category here.</p>'}
        <button class="btn add-cat" data-cat-action="add" data-id="${esc(g.id)}">+ Add a category to this group</button>
      </section>`;
    })
    .join('');
  return `
    <div class="view-head">
      <div class="view-title"><h1>Categories and groups</h1>
        <p class="muted">A <strong>category</strong> is one product page on the website, for example Liquid Gold &amp; Platinum.
        A <strong>group</strong> is a heading that categories are listed under, in the Products menu and on the Products page.</p></div>
      <button class="btn primary" data-cat-action="add-group">+ Add a group</button>
    </div>
    <ol class="how">
      <li>Use <strong>↑ ↓</strong> to change the order. Moving past the top or bottom of a group moves the category into the next group.</li>
      <li>Press <strong>Edit</strong> to change a category's name, temperatures, description or group.</li>
      <li>Changes show on the website after you press <strong>Publish changes</strong>.</li>
    </ol>
    ${groups}`;
}

function uniqueId(base, taken) {
  let id = Backend.slug(base).replace(/^photo$/, 'range');
  if (Backend.reserved.has(id) || /^\d+$/.test(id)) id = `${id}-range`;
  let n = 2;
  let out = id;
  while (taken.has(out)) out = `${id}-${n++}`;
  return out;
}

async function categoryAction(action, id) {
  const c = cats();
  const groupOf = (cid) => c.groups.find((g) => g.categories.includes(cid));
  if (action === 'up' || action === 'down') {
    const g = groupOf(id);
    const gi = c.groups.indexOf(g);
    const i = g.categories.indexOf(id);
    const dir = action === 'up' ? -1 : 1;
    const j = i + dir;
    g.categories.splice(i, 1);
    if (j >= 0 && j <= g.categories.length && !(dir === 1 && i === g.categories.length)) {
      g.categories.splice(j, 0, id);
    } else {
      // Past the edge of the group: into the next group along (its end when going up, its start when going down).
      const next = c.groups[gi + dir];
      if (!next) g.categories.splice(i, 0, id);
      else if (dir === -1) next.categories.push(id);
      else next.categories.unshift(id);
      if (next) toast(`${c.categories[id].short} is now in the group "${next.title}".`);
    }
  } else if (action === 'group-up' || action === 'group-down') {
    const gi = c.groups.findIndex((g) => g.id === id);
    const j = gi + (action === 'group-up' ? -1 : 1);
    if (j < 0 || j >= c.groups.length) return;
    [c.groups[gi], c.groups[j]] = [c.groups[j], c.groups[gi]];
  } else if (action === 'rename-group') {
    const g = c.groups.find((x) => x.id === id);
    const title = await askText('Rename the group', 'Group name', g.title, 'Shown as a heading in the Products menu and on the Products page.');
    if (!title) return;
    g.title = title;
  } else if (action === 'delete-group') {
    const g = c.groups.find((x) => x.id === id);
    if (g.categories.length) return toast('Move the categories out of this group first.');
    if (!(await confirmBox(`Delete the group "${g.title}"?`, 'It has no categories, so nothing else changes.', 'Delete group', true))) return;
    c.groups = c.groups.filter((x) => x !== g);
  } else if (action === 'add-group') {
    const title = await askText('Add a group', 'Group name', '', 'For example: Colours for glass. You can then add categories to it.');
    if (!title) return;
    c.groups.push({ id: uniqueId(title, new Set(c.groups.map((g) => g.id))), title, categories: [] });
  } else if (action === 'add') {
    return openCategory(null, id);
  }
  changed();
  renderMain();
}

function moveCategoryTo(id, groupId) {
  const c = cats();
  for (const g of c.groups) g.categories = g.categories.filter((x) => x !== id);
  c.groups.find((g) => g.id === groupId)?.categories.push(id);
}

/** A small "type a name" question, used for group names. Resolves with the text, or '' when cancelled. */
function askText(title, label, value, help) {
  const dlg = $('#askDialog');
  $('#askTitle').textContent = title;
  $('#askLabel').textContent = label;
  $('#askHelp').textContent = help || '';
  const input = $('#askInput');
  input.value = value || '';
  $('#askError').hidden = true;
  dlg.returnValue = '';
  dlg.showModal();
  input.focus();
  return new Promise((resolve) => {
    const form = $('#askForm');
    const submit = (e) => {
      e.preventDefault();
      if (e.submitter?.value === 'no') return dlg.close();
      if (!input.value.trim()) {
        $('#askError').textContent = 'Write a name.';
        $('#askError').hidden = false;
        return;
      }
      dlg.close('yes');
    };
    form.addEventListener('submit', submit);
    dlg.addEventListener(
      'close',
      () => {
        form.removeEventListener('submit', submit);
        resolve(dlg.returnValue === 'yes' ? input.value.trim().replace(/\s+/g, ' ') : '');
      },
      { once: true },
    );
  });
}

function blankCategory() {
  return { title: '', short: '', min: null, max: null, summary: '', points: [], notes: [], description: '', image: null, layout: 'shades', code: 'optional', types: [], hidden: false };
}

function openCategory(id, groupId) {
  const c = cats();
  const existing = id ? c.categories[id] : null;
  const item = existing ? clone(existing) : blankCategory();
  const group = id ? c.groups.find((g) => g.categories.includes(id))?.id : groupId || c.groups[0]?.id;
  panelState = { kind: 'category', section: 'category', id, item, group, types: clone(item.types), dirty: false, hexTouched: true };
  const dlg = $('#panel');
  dlg.innerHTML = categoryForm();
  dlg.showModal();
  wirePanel();
  if (finePointer()) dlg.querySelector('input[name=title]').focus();
}

function typeRows() {
  const rows = panelState.types
    .map(
      (t, i) => `<li class="type-row">
        <label class="field"><span>Type name</span><input data-type="${i}" data-field="label" value="${esc(t.label)}" maxlength="40" autocomplete="off"></label>
        <label class="field small"><span>From °C</span><input data-type="${i}" data-field="min" type="number" inputmode="numeric" value="${esc(t.min ?? '')}"></label>
        <label class="field small"><span>To °C</span><input data-type="${i}" data-field="max" type="number" inputmode="numeric" value="${esc(t.max ?? '')}"></label>
        <button type="button" class="icon-btn" data-remove-type="${i}" aria-label="Remove the type ${esc(t.label)}" title="Remove">✕</button>
      </li>`,
    )
    .join('');
  return `${rows ? `<ul class="type-list">${rows}</ul>` : '<p class="help">No types: all products in this category are shown together.</p>'}
    <button type="button" class="btn" id="addType">+ Add a type</button>`;
}

function categoryForm() {
  const { id, item, group } = panelState;
  const c = cats();
  const n = id ? (S.work[productPath(id)] || []).length : 0;
  const noTemps = item.min === null && item.max === null;
  const layout = item.layout === 'grades' ? 'grades' : item.code === 'required' ? 'code' : 'name';
  const layoutLabels = {
    code: 'Every colour has a code (like ceramic colours, e.g. 3589 Cobalt Blue)',
    name: 'Colours by name, code if there is one (like lustres)',
    grades: 'Sold by purity (like liquid gold: 7%, 10%, 12%)',
  };
  const site = (S.settings.site_url || '').replace(/^https?:\/\/(www\.)?/, '');
  const canDelete = id && !item.builtIn;
  return `<form method="dialog" id="itemForm" novalidate>
    <div class="panel-head"><h2 id="panelTitle">${id ? 'Edit category' : 'Add a category'}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    <div class="panel-body">
      <label class="field"><span>Name of the category</span><input name="title" value="${esc(item.title)}" maxlength="80" autocomplete="off">
        <small>The heading of its page, for example "Pigment for Glass Lined Coatings". Long names are fine.</small><span class="field-error" data-error="title" hidden></span></label>
      <label class="field"><span>Short name, for menus</span><input name="short" value="${esc(item.short)}" maxlength="32" autocomplete="off">
        <small>2 or 3 words, for example "Glass-lined pigments". Used where space is small, like the phone menu.</small><span class="field-error" data-error="short" hidden></span></label>
      ${id ? `<p class="help">Web address: <strong>${esc(site)}/${esc(id)}</strong> (stays the same when the name changes)</p>` : ''}

      <fieldset class="choices"><legend class="legend">Group</legend>
        ${c.groups.map((g) => `<label class="choice"><input type="radio" name="group" value="${esc(g.id)}" ${group === g.id ? 'checked' : ''}><span>${esc(g.title)}</span></label>`).join('')}
        <label class="choice"><input type="radio" name="group" value="__new" ${c.groups.length ? '' : 'checked'}><span>A new group…</span></label>
      </fieldset>
      <label class="field" id="newGroupField" ${c.groups.length ? 'hidden' : ''}><span>Name of the new group</span><input name="newGroup" maxlength="60" autocomplete="off"><span class="field-error" data-error="newGroup" hidden></span></label>

      <div class="field"><span class="legend">Firing temperature</span>
        <div class="grid-2">
          <label class="field"><span>Lowest (°C)</span><input name="min" type="number" inputmode="numeric" value="${esc(item.min ?? '')}" ${noTemps ? 'disabled' : ''}></label>
          <label class="field"><span>Highest (°C)</span><input name="max" type="number" inputmode="numeric" value="${esc(item.max ?? '')}" ${noTemps ? 'disabled' : ''}></label>
        </div>
        <label class="check"><input type="checkbox" name="noTemps" ${noTemps ? 'checked' : ''}> No firing temperature, or not known yet</label>
        <span class="field-error" data-error="temps" hidden></span>
      </div>

      <label class="field"><span>Short description</span><textarea name="summary" rows="3" maxlength="400">${esc(item.summary)}</textarea>
        <small>One or two sentences, shown on the Products page and the category page.</small><span class="field-error" data-error="summary" hidden></span></label>
      <label class="field"><span>Points on the Products page</span><textarea name="points" rows="3">${esc(item.points.join('\n'))}</textarea><small>One point per line. Can be empty.</small></label>
      <label class="field"><span>Notes at the top of the category page</span><textarea name="notes" rows="3">${esc(item.notes.join('\n'))}</textarea><small>One note per line. Can be empty.</small></label>

      ${photoBlock()}
      <p class="help">The photo for this category's tile on the home page and Products page. Without one, a plain coloured tile is shown.</p>

      ${
        n === 0
          ? `<fieldset class="choices"><legend class="legend">How are the products listed?</legend>
              ${Object.entries(layoutLabels).map(([v, l]) => `<label class="choice wide"><input type="radio" name="layout" value="${v}" ${layout === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}
            </fieldset>`
          : `<p class="help">Products are listed: ${esc(layoutLabels[layout])}. This can only be changed while the category is empty.</p>`
      }

      <div class="field"><span class="legend">Types (optional)</span>
        <small class="help">Types let customers filter the list, for example "On-glaze" and "Glass". Temperatures are only needed if a type fires differently from the whole category.</small>
        <div id="typeBox">${typeRows()}</div>
        <span class="field-error" data-error="types" hidden></span>
      </div>

      <label class="check"><input type="checkbox" name="show" ${item.hidden ? '' : 'checked'}> Show this category on the website</label>

      <details class="advanced"><summary>For Google (optional)</summary>
        <label class="field"><span>Description for Google search results</span><textarea name="description" rows="3" maxlength="300">${esc(item.description || '')}</textarea>
        <small>Leave empty to use the short description.</small></label>
      </details>
      <p class="form-error" id="formError" role="alert" hidden></p>
    </div>
    <div class="panel-foot">
      ${canDelete ? '<button type="button" class="btn danger" id="deleteItem">Delete</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>`;
}

function wireCategoryForm(form) {
  form.addEventListener('change', (e) => {
    if (e.target.name === 'group') $('#newGroupField').hidden = e.target.value !== '__new';
    if (e.target.name === 'noTemps') form.querySelectorAll('input[name=min], input[name=max]').forEach((x) => (x.disabled = e.target.checked));
  });
  // Suggest a short name from the name while the short name has not been typed in.
  let shortTouched = !!panelState.item.short;
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'short') shortTouched = true;
    if (t.name === 'title' && !shortTouched) form.short.value = t.value.trim().split(/\s+/).slice(0, 3).join(' ');
    if (t.dataset.type !== undefined) {
      const ty = panelState.types[Number(t.dataset.type)];
      if (t.dataset.field === 'label') ty.label = t.value;
      else ty[t.dataset.field] = t.value === '' ? null : parseInt(t.value, 10);
    }
  });
  form.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'addType') {
      panelState.types.push({ id: '', label: '', min: null, max: null });
      panelState.dirty = true;
      $('#typeBox').innerHTML = typeRows();
      $('#typeBox').querySelector(`[data-type="${panelState.types.length - 1}"]`).focus();
    } else if (t.dataset.removeType !== undefined) {
      const i = Number(t.dataset.removeType);
      const ty = panelState.types[i];
      const used = ty.id && panelState.id ? (S.work[productPath(panelState.id)] || []).filter((x) => x.range === ty.id).length : 0;
      if (used) return showErrors({ types: `${used} ${used === 1 ? 'product uses' : 'products use'} the type "${ty.label}". Change their type first.` });
      panelState.types.splice(i, 1);
      panelState.dirty = true;
      $('#typeBox').innerHTML = typeRows();
    }
  });
}

function saveCategory() {
  const form = $('#itemForm');
  const data = Object.fromEntries(new FormData(form));
  const c = cats();
  const { id, item } = panelState;
  const errors = {};
  const title = (data.title || '').trim().replace(/\s+/g, ' ');
  const short = (data.short || '').trim().replace(/\s+/g, ' ');
  if (!title) errors.title = 'Write the name of the category.';
  if (!short) errors.short = 'Write a short name for menus.';
  const dupe = Object.entries(c.categories).find(([k, x]) => k !== id && (x.title.toLowerCase() === title.toLowerCase() || x.short.toLowerCase() === short.toLowerCase()));
  if (dupe && title) errors.title = `There is already a category called "${dupe[1].title}" (${dupe[1].short}).`;
  let min = null;
  let max = null;
  if (!data.noTemps) {
    min = parseInt(data.min, 10);
    max = parseInt(data.max, 10);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 100 || max > 2000 || min >= max)
      errors.temps = 'Write both temperatures in °C, the lowest below the highest. Or tick "No firing temperature".';
  }
  if (!(data.summary || '').trim()) errors.summary = 'Write a sentence about this category.';
  let groupId = data.group;
  if (groupId === '__new' && !(data.newGroup || '').trim()) errors.newGroup = 'Write the name of the new group.';
  const labels = new Set();
  for (const t of panelState.types) {
    const l = (t.label || '').trim().toLowerCase();
    if (!l) errors.types = 'Every type needs a name. Remove the empty ones.';
    else if (labels.has(l)) errors.types = `There are two types called "${t.label}".`;
    else if ((t.min === null) !== (t.max === null) || (t.min !== null && !(t.min < t.max)))
      errors.types = `Type "${t.label}": write both temperatures (lowest first), or leave both empty.`;
    labels.add(l);
  }
  if (Object.keys(errors).length) return showErrors(errors);

  const cid = id || uniqueId(short, new Set([...Object.keys(c.categories), ...Object.keys(S.base[FILES.categories]?.categories || {})]));
  // Give new types an id; keep existing ids so products stay linked to their type.
  const typeIds = new Set();
  const types = panelState.types.map((t) => {
    const tid = t.id || uniqueId(t.label, typeIds);
    typeIds.add(tid);
    const out = { id: tid, label: t.label.trim() };
    if (t.min !== null && t.max !== null) Object.assign(out, { min: t.min, max: t.max });
    if (t.note) out.note = t.note;
    return out;
  });
  const layout = data.layout || (item.layout === 'grades' ? 'grades' : item.code === 'required' ? 'code' : 'name');
  const cat = {
    ...item,
    title,
    short,
    min,
    max,
    summary: data.summary.trim(),
    points: (data.points || '').split('\n').map((x) => x.trim()).filter(Boolean),
    notes: (data.notes || '').split('\n').map((x) => x.trim()).filter(Boolean),
    description: (data.description || '').trim(),
    image: panelState.item.image || null,
    layout: layout === 'grades' ? 'grades' : 'shades',
    types,
    hidden: !data.show,
  };
  if (layout === 'grades') delete cat.code;
  else cat.code = layout === 'code' ? 'required' : 'optional';
  if (!cat.hidden) delete cat.hidden;
  if (!id) cat.folder = cid;
  c.categories[cid] = cat;

  if (groupId === '__new') {
    const title = data.newGroup.trim().replace(/\s+/g, ' ');
    groupId = uniqueId(title, new Set(c.groups.map((g) => g.id)));
    c.groups.push({ id: groupId, title, categories: [] });
  }
  const current = c.groups.find((g) => g.categories.includes(cid));
  if (current?.id !== groupId) moveCategoryTo(cid, groupId);

  // Keep every product's type valid: with no types, products use the category id; new types start with the first one.
  const path = productPath(cid);
  if (!S.work[path]) {
    S.work[path] = [];
    if (S.base[path] === undefined) S.base[path] = [];
  }
  const valid = new Set(types.length ? types.map((t) => t.id) : [cid]);
  for (const p of S.work[path]) if (!valid.has(p.range)) p.range = [...valid][0];

  $('#panel').close();
  panelState = null;
  changed();
  if (!id) {
    S.view = cid;
    S.q = '';
    S.filter = 'all';
  }
  render();
  toast(id ? `Saved ${short}. Press "Publish changes" to put it on the website.` : `Added ${short}. Now add its colours, then press "Publish changes".`);
}

async function deleteCategory() {
  const { id } = panelState;
  const c = cats();
  const cat = c.categories[id];
  const n = (S.work[productPath(id)] || []).length;
  if (n) return showErrors({ title: `Delete or move its ${n} ${n === 1 ? 'product' : 'products'} first. To keep them but take the page off the website, untick "Show this category on the website".` });
  if (!(await confirmBox(`Delete ${cat.title}?`, 'Its page will be removed from the website when you publish.', 'Delete', true))) return;
  delete c.categories[id];
  for (const g of c.groups) g.categories = g.categories.filter((x) => x !== id);
  if (S.base[productPath(id)]?.length === 0 && !S.base[FILES.categories]?.categories?.[id]) {
    delete S.base[productPath(id)];
    delete S.work[productPath(id)];
  }
  $('#panel').close();
  panelState = null;
  if (S.view === id) S.view = 'categories';
  changed();
  render();
  toast(`Deleted ${cat.title}.`);
}

function helpView() {
  const android = /Android/i.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches || window.Capacitor;
  return `
    <div class="view-head"><div class="view-title"><h1>How to use the editor</h1></div></div>
    <div class="sheet">
      ${
        installed
          ? ''
          : `<h2>Put the editor on ${android ? 'this phone' : 'this computer'}</h2>
        <p>${installPrompt ? 'Press the button to add the editor as an app, with its own icon.' : android ? 'In Chrome, open the menu (⋮) and choose <strong>Add to home screen</strong> → <strong>Install</strong>.' : 'In Edge, open the menu (⋯) and choose <strong>Apps</strong> → <strong>Install this site as an app</strong>. Tick “Create desktop shortcut”.'}</p>
        ${installPrompt ? '<p><button class="btn primary" id="installBtn">Install the editor as an app</button></p>' : ''}`
      }
      <h2>Add a colour</h2>
      <ol class="steps">
        <li>Choose the category in the menu, for example <strong>Ceramic colours</strong>.</li>
        <li>Press <strong>Add a colour</strong>. Fill in the name and code, choose the type and stock.</li>
        <li>Press <strong>Choose photo</strong>${android ? '' : ', or drag a photo onto the dotted box'}. A clear daylight photo on white paper works best.</li>
        <li>Press <strong>Save</strong>. The colour shows on the list with a green <strong>New</strong> label.</li>
      </ol>
      <h2>Add a new product category</h2>
      <ol class="steps">
        <li>Open <strong>Categories and groups</strong> (under "Set up" in the menu).</li>
        <li>Press <strong>+ Add a category to this group</strong> in the group it belongs to.</li>
        <li>Write its name and a short name for menus, the firing temperature and a sentence about it. Press <strong>Save</strong>.</li>
        <li>It now has its own list in the menu: add its colours there, then publish. The website gets a new page for it.</li>
      </ol>
      <h2>Put changes on the website</h2>
      <ol class="steps">
        <li>Press <strong>Publish</strong> at the top. You will see a list of everything that changed.</li>
        <li>Press <strong>Publish now</strong>. The website updates in about 2 minutes.</li>
      </ol>
      <h2>Good to know</h2>
      <ul class="steps">
        <li>You can close the editor at any time. Changes that are not published yet are kept on this ${android ? 'phone' : 'computer'} for next time.</li>
        <li>Made a mistake? Open the item and change it, or press <strong>Undo all</strong> before publishing.</li>
        <li>Colours without a photo show as a coloured tile with the code, labelled "screen colour only".</li>
        <li>If something says it could not reach GitHub, check the internet and try again.</li>
        <li>Want to try things out first? Open the editor in <strong>practice mode</strong>: <button class="link" data-open-practice>open practice mode</button>. Nothing you do there changes the website.</li>
      </ul>
    </div>`;
}

/* ---------- item panel (add / edit) ---------- */

let panelState = null; // { section, path, id, item, dirty }

function blankItem(section) {
  if (section === 'gallery') return { image: null, caption: '', category: 'ceramic' };
  const cfg = cfgOf(section);
  const item = { name: '', hex: '#888888', image: null, stock: 'in', range: cfg.types()[0][0] };
  if (cfg.code) item.code = '';
  if (cfg.purity) item.purity = '';
  return item;
}

function openPanel(section, id) {
  const path = section === 'gallery' ? FILES.gallery : productPath(section);
  const list = S.work[path];
  const existing = id ? list.find((x) => x.__id === id) : null;
  const item = existing ? clone(existing) : blankItem(section);
  panelState = { section, path, id: existing ? id : null, item, dirty: false, hexTouched: !!existing, pos: existing ? list.indexOf(existing) : 0 };
  const dlg = $('#panel');
  dlg.innerHTML = section === 'gallery' ? galleryForm() : productForm();
  dlg.showModal();
  wirePanel();
  const first = dlg.querySelector(section === 'gallery' ? 'textarea, input[name=caption]' : 'input[name=name]');
  // On phones, opening the keyboard straight away hides half the form; there they tap the field they want.
  if (finePointer()) first?.focus();
}

function photoBlock() {
  const it = panelState.item;
  return `<div class="photo-field" id="photoField">
      <div class="thumb" id="photoPreview">${thumb(it, it.code || it.purity || '')}</div>
      <div class="photo-actions">
        <span class="legend">Photo</span>
        <label class="btn"><input type="file" id="photoInput" accept="image/jpeg,image/png,image/webp" hidden>Choose photo…</label>
        ${finePointer() ? '<span class="help">or drag a photo onto this box</span>' : ''}
        ${it.image && panelState.section !== 'gallery' ? '<button type="button" class="link" id="removePhoto">Remove photo</button>' : ''}
        <span class="help" id="photoStatus" role="status"></span>
      </div>
    </div>`;
}

function productForm() {
  const { section, item, id, path } = panelState;
  const cfg = cfgOf(section);
  const names = [...new Set((S.work[path] || []).map((x) => x.name))];
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
  $('#photoPreview').innerHTML = thumb(it, it.code || it.purity || it.short || '');
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
  if (panelState.kind === 'category') wireCategoryForm(form);
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
  $('#deleteItem')?.addEventListener('click', panelState.kind === 'category' ? deleteCategory : deleteItem);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (panelState.kind === 'category') saveCategory();
    else saveItem();
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
    const cfg = cfgOf(section);
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
  const photos =
    allPaths().reduce((n, p) => n + (Array.isArray(S.work[p]) ? S.work[p].filter((x) => x.image?.startsWith('draft:')).length : 0), 0) +
    Object.values(cats().categories).filter((c) => c.image?.startsWith('draft:')).length;
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
    const r = await api('/api/publish', { files, baseShas, message, categories: strip(S.work[FILES.categories]) });
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
    <p id="deployText">${S.practice ? 'Practice mode: this was not really published. Nothing on the website changed.' : 'The website is updating. This usually takes about 2 minutes.'}</p></div></div>
    <div class="modal-actions">${S.local ? '' : '<button class="btn" id="openSite">Open the website</button>'}<button class="btn primary" id="pubDone">Done</button></div>`);
  $('#pubDone', dlg).onclick = () => dlg.close();
  $('#openSite', dlg)?.addEventListener('click', () => api('/api/open', { url: site }).catch(() => {}));
  if (S.practice || !sha) return;
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
    } else if (t.dataset.editCat) {
      openCategory(t.dataset.editCat);
    } else if (t.dataset.catAction) {
      categoryAction(t.dataset.catAction, t.dataset.id);
    } else if (t.id === 'installBtn') {
      installApp();
    } else if (t.hasAttribute('data-reload')) {
      location.reload();
    } else if (t.hasAttribute('data-open-practice')) {
      location.href = `${location.pathname}?practice`;
    }
    if (t.dataset.view || t.id === 'sideToggle') setSideOpen(t.id === 'sideToggle' && !document.body.classList.contains('side-open'));
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
  });
  $('#main').addEventListener('change', (e) => {
    if (e.target.dataset.moveTo) moveCategoryTo(e.target.dataset.moveTo, e.target.value);
  });
  $('#panel').addEventListener('cancel', (e) => {
    e.preventDefault();
    closePanel();
  });
  $('#publishBtn').addEventListener('click', openPublish);
  $('#undoAll').addEventListener('click', async () => {
    if (!(await confirmBox('Undo all changes?', 'Everything you changed since the last publish will be thrown away.', 'Undo all', true))) return;
    S.work = clone(S.base);
    for (const p of Object.keys(S.work)) if (S.base[p] === undefined) delete S.work[p];
    await api('/api/discard', {}).catch(() => {});
    render();
    toast('All changes undone.');
  });
  $('#settingsBtn').addEventListener('click', async () => {
    if (S.practice) return toast('Practice mode has no settings.');
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
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if (S.view === 'help') renderMain();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setSideOpen(false));

  // Android app: the back button closes whatever is open (form, question, menu) before leaving the app.
  const androidApp = window.Capacitor?.Plugins?.App;
  androidApp?.addListener('backButton', () => {
    const open = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (open?.id === 'panel') return closePanel();
    if (open) return open.close();
    if (document.body.classList.contains('side-open')) return setSideOpen(false);
    if (!$('#setup').hidden && !$('#setupBack').hidden) return $('#setupBack').click();
    flushDraft();
    androidApp.minimizeApp();
  });
}

function setSideOpen(open) {
  document.body.classList.toggle('side-open', open);
  $('#sideToggle').setAttribute('aria-expanded', String(open));
}

// "Install as an app": Edge/Chrome offer this for the editor's web address; it adds a desktop and Start menu icon.
let installPrompt = null;
async function installApp() {
  if (!installPrompt) return toast('Use the browser menu (⋯) → Apps → Install this site as an app.');
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  renderMain();
}

async function start() {
  wire();
  // Lets Edge and Chrome install the editor as an app (desktop icon, own window). Not needed inside the Android app.
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) navigator.serviceWorker.register('sw.js').catch(() => {});
  try {
    const st = await api('/api/state');
    S.settings = st.settings;
    S.local = st.local;
    S.practice = st.practice;
    document.body.classList.toggle('practice', !!st.practice);
    if (!st.configured) return showSetup(true);
    $('#app').hidden = false;
    await loadAll();
  } catch (e) {
    $('#app').hidden = false;
    $('#main').innerHTML = `<div class="sheet"><h1>Could not open the website</h1><p>${esc(e.message)}</p><p><button class="btn primary" data-reload>Try again</button></p></div>`;
    $('#status').textContent = '';
  }
}

start();
