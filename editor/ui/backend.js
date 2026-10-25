/* SVE Website Editor: everything outside the page, done inside the browser (Windows app window, Android app,
   or any browser): reading and saving the website on GitHub, preparing photos, and keeping the unpublished
   draft on this device. app.js calls it through api(path, body), the same routes the old local server had.

   Photos are only resized and saved as JPEG. Their colours are never adjusted: the photo's own colour
   profile is copied into the new file, so it shows exactly as the original. */

'use strict';

const Backend = (() => {
  const DEFAULTS = {
    repo: 'shrivijaylustures-ops/ShriVijayEnterprises',
    branch: 'redesign',
    site_url: 'https://www.shrivijayenterprises.in',
  };
  const API = 'https://api.github.com';
  const MAX_SIDE = 2000;
  const MAX_UPLOAD = 40 * 1024 * 1024;
  const STOCK = new Set(['in', 'low', 'out']);
  const GALLERY_CATEGORIES = new Set(['gold', 'lustre', 'glass', 'ceramic', 'packing']);
  const HEX = /^#[0-9A-Fa-f]{6}$/;
  const FIXED = { categories: 'src/data/categories.json', gallery: 'src/data/gallery.json', site: 'src/data/site.json' };
  // Category ids become web addresses (/gold) and data files (src/data/gold.json), so these are taken.
  const RESERVED = new Set([
    'products', 'gallery', 'aboutus', 'contact', 'index', '404', 'llms', 'editor', 'sitemap', 'sitemap-index',
    'site', 'categories', 'ranges', 'lines', 'help', 'contact-details', 'brand', 'fonts', 'favicon', 'icons', 'og', 'robots', 'assets', 'resources', 'api',
  ]);

  // Practice mode (?practice): reads the real website but never saves to it. For learning and testing.
  const params = new URLSearchParams(location.search);
  const practice = params.has('practice');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const prefix = practice ? 'sve-practice-' : 'sve-editor-';

  class StoreError extends Error {
    constructor(message, status = 400, conflict) {
      super(message);
      this.status = status;
      this.conflict = conflict;
    }
  }
  const conflictError = (paths = []) =>
    new StoreError('The website was changed from somewhere else after you opened the editor. Press "Get latest" and make your changes again.', 409, paths);

  /* ---------- small storage helpers ---------- */

  const ls = {
    get(key) {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(prefix + key, value);
      } catch {
        throw new StoreError('This device has no room left to keep your changes. Publish them, or free some space.');
      }
    },
    del(key) {
      try {
        localStorage.removeItem(prefix + key);
      } catch {}
    },
  };

  const settings = () => {
    let saved = {};
    try {
      saved = JSON.parse(ls.get('settings') || '{}');
    } catch {}
    return { ...DEFAULTS, ...saved };
  };
  const token = () => (practice ? 'practice' : ls.get('token') || '');

  // Draft photos live in IndexedDB (they can be several MB; localStorage is too small).
  let dbp;
  function db() {
    dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(prefix + 'photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new StoreError('This device would not let the editor keep photos. Try another browser.'));
    });
    return dbp;
  }
  async function idb(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('photos', mode);
      const req = fn(tx.objectStore('photos'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(new StoreError('Could not keep the photo on this device. Try again.'));
    });
  }
  const urls = new Map(); // draft photo id -> object URL, so <img> tags can show them
  const published = new Map(); // website path -> object URL, for photos just published (GitHub can take minutes to serve them)

  /* ---------- encoding ---------- */

  const utf8 = new TextEncoder();
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const unb64 = (s) => Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  const dumpJson = (data) => JSON.stringify(data, null, 2) + '\n';
  async function blobSha(bytes) {
    const head = utf8.encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(head.length + bytes.length);
    all.set(head);
    all.set(bytes, head.length);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
    return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const slug = (text) =>
    (String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')) || 'photo';
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  /* ---------- GitHub ---------- */

  class GitHubStore {
    constructor(tok, repo, branch, api = API) {
      this.token = tok.trim();
      this.repo = repo.trim().replace(/^\/+|\/+$/g, '');
      this.branch = branch.trim();
      this.api = api.replace(/\/+$/, '');
    }

    async request(method, path, body, raw = false) {
      let res;
      try {
        res = await fetch(this.api + path, {
          method,
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        throw new StoreError('Could not reach GitHub. Check the internet connection and try again.');
      }
      if (!res.ok) {
        let detail = '';
        try {
          detail = (await res.json()).message || '';
        } catch {}
        const c = res.status;
        if (c === 401) throw new StoreError('GitHub did not accept the key. If this keeps happening, ask Kartik to set the editor up again.');
        if (c === 403 && /rate limit/i.test(detail)) throw new StoreError('GitHub is busy right now. Wait a few minutes and try again.');
        if ((c === 403 || c === 404) && method !== 'GET')
          throw new StoreError('The GitHub key is not allowed to change the website. Ask Kartik to check its permissions.');
        if (c === 404) throw new StoreError('Not found.', 404);
        if (c === 409 || c === 422) throw conflictError();
        throw new StoreError(`GitHub said: ${detail || res.statusText} (${c}). Try again in a minute.`);
      }
      if (raw) return new Uint8Array(await res.arrayBuffer());
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }

    repoPath(suffix) {
      return `/repos/${this.repo}${suffix}`;
    }
    contents(path) {
      return this.repoPath(`/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`);
    }

    async check() {
      let info;
      try {
        info = await this.request('GET', this.repoPath(''));
      } catch (e) {
        if (e.status === 404) throw new StoreError(`Repository "${this.repo}" not found, or the key cannot see it.`);
        throw e;
      }
      if (info.permissions && !info.permissions.push)
        throw new StoreError('This key can read the website but not change it. Give it "Contents: Read and write".');
      try {
        await this.request('GET', this.repoPath(`/branches/${encodeURIComponent(this.branch)}`));
      } catch (e) {
        if (e.status === 404) throw new StoreError(`Branch "${this.branch}" not found in ${this.repo}.`);
        throw e;
      }
      try {
        await this.readJson(FIXED.categories);
      } catch (e) {
        if (e.status === 404)
          throw new StoreError(`Branch "${this.branch}" does not have the newest website yet (src/data/categories.json is missing).`);
        throw e;
      }
    }

    async readJson(path) {
      const meta = await this.request('GET', this.contents(path));
      return { content: JSON.parse(new TextDecoder().decode(unb64(meta.content))), sha: meta.sha };
    }

    async fileSha(path) {
      try {
        return (await this.request('GET', this.contents(path))).sha;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    }

    /** Save several files in one commit. files: { path: Uint8Array }. */
    async commit(files, message, baseShas) {
      const changed = [];
      for (const [p, sha] of Object.entries(baseShas)) if ((await this.fileSha(p)) !== sha) changed.push(p);
      if (changed.length) throw conflictError(changed);
      const refPath = this.repoPath(`/git/ref/heads/${encodeURIComponent(this.branch)}`);
      const head = (await this.request('GET', refPath)).object.sha;
      const baseTree = (await this.request('GET', this.repoPath(`/git/commits/${head}`))).tree.sha;
      const tree = [];
      for (const [path, data] of Object.entries(files)) {
        const blob = await this.request('POST', this.repoPath('/git/blobs'), { content: b64(data), encoding: 'base64' });
        tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const newTree = await this.request('POST', this.repoPath('/git/trees'), { base_tree: baseTree, tree });
      const commit = await this.request('POST', this.repoPath('/git/commits'), { message, tree: newTree.sha, parents: [head] });
      await this.request('PATCH', this.repoPath(`/git/refs/heads/${encodeURIComponent(this.branch)}`), { sha: commit.sha, force: false });
      return { sha: commit.sha, url: commit.html_url || '' };
    }

    /** 'success', 'failure', 'pending' or 'unknown', from the checks the hosting service reports to GitHub. */
    async deployStatus(sha) {
      const states = [];
      try {
        const combined = await this.request('GET', this.repoPath(`/commits/${sha}/status`));
        states.push(...(combined.statuses || []).map((s) => s.state));
      } catch {}
      try {
        const runs = await this.request('GET', this.repoPath(`/commits/${sha}/check-runs`));
        for (const r of runs.check_runs || [])
          states.push(r.status !== 'completed' ? 'pending' : ['success', 'neutral', 'skipped'].includes(r.conclusion) ? 'success' : 'failure');
      } catch {}
      if (!states.length) return 'unknown';
      if (states.some((s) => s === 'failure' || s === 'error')) return 'failure';
      if (states.includes('pending')) return 'pending';
      return 'success';
    }
  }

  /** Practice: reads the live files without a key, keeps "published" changes in memory only. */
  class PracticeStore {
    constructor(repo, branch) {
      this.raw = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/`;
      this.saved = new Map();
    }
    async check() {}
    async readJson(path) {
      if (this.saved.has(path)) return this.saved.get(path);
      let res;
      try {
        res = await fetch(this.raw + encPath(path), { cache: 'no-store' });
      } catch {
        throw new StoreError('Could not reach GitHub. Check the internet connection and try again.');
      }
      if (res.status === 404) throw new StoreError('Not found.', 404);
      if (!res.ok) throw new StoreError('Could not read the website. Try again in a minute.');
      const bytes = new Uint8Array(await res.arrayBuffer());
      return { content: JSON.parse(new TextDecoder().decode(bytes)), sha: await blobSha(bytes) };
    }
    async commit(files) {
      for (const [path, data] of Object.entries(files))
        if (path.endsWith('.json')) this.saved.set(path, { content: JSON.parse(new TextDecoder().decode(data)), sha: await blobSha(data) });
      return { sha: 'practice', url: '' };
    }
    async deployStatus() {
      return 'success';
    }
  }

  function store() {
    const s = settings();
    if (practice) return new PracticeStore(s.repo, s.branch);
    if (!token()) throw new StoreError('The editor is not set up yet.');
    return new GitHubStore(token(), s.repo, s.branch, (local && s.api) || API);
  }

  /* ---------- photos ---------- */

  /** The colour-profile (ICC) segments of a JPEG, to copy into the resized photo unchanged. */
  function jpegIcc(bytes) {
    const out = [];
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return out;
    let i = 2;
    while (i + 4 < bytes.length && bytes[i] === 0xff) {
      const marker = bytes[i + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === 0xe2 && String.fromCharCode(...bytes.subarray(i + 4, i + 15)) === 'ICC_PROFILE') out.push(bytes.subarray(i, i + 2 + len));
      i += 2 + len;
    }
    return out;
  }

  /** The colour profile of a PNG (iCCP chunk, zlib-compressed), wrapped as JPEG ICC segments. */
  async function pngIcc(bytes) {
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return [];
    let i = 8;
    while (i + 8 < bytes.length) {
      const len = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
      const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
      if (type === 'iCCP') {
        const data = bytes.subarray(i + 8, i + 8 + len);
        const nul = data.indexOf(0);
        try {
          const stream = new Blob([data.subarray(nul + 2)]).stream().pipeThrough(new DecompressionStream('deflate'));
          return iccSegments(new Uint8Array(await new Response(stream).arrayBuffer()));
        } catch {
          return [];
        }
      }
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
    return [];
  }

  function iccSegments(profile) {
    const max = 65519; // bytes of profile per APP2 segment
    const n = Math.ceil(profile.length / max);
    const segs = [];
    for (let k = 0; k < n; k++) {
      const part = profile.subarray(k * max, (k + 1) * max);
      const seg = new Uint8Array(4 + 14 + part.length);
      const len = seg.length - 2;
      seg.set([0xff, 0xe2, len >> 8, len & 255]);
      seg.set(utf8.encode('ICC_PROFILE\0'), 4);
      seg.set([k + 1, n], 16);
      seg.set(part, 18);
      segs.push(seg);
    }
    return segs;
  }

  /** Put the original photo's ICC segments in place of the profile the browser's JPEG encoder adds (always sRGB). */
  function withIcc(jpeg, segs) {
    if (!segs.length) return jpeg;
    const own = jpegIcc(jpeg);
    if (own.length) {
      const keep = [];
      let from = 0;
      for (const seg of own) {
        const at = seg.byteOffset - jpeg.byteOffset;
        keep.push(jpeg.subarray(from, at));
        from = at + seg.length;
      }
      keep.push(jpeg.subarray(from));
      const total = keep.reduce((n, k) => n + k.length, 0);
      const stripped = new Uint8Array(total);
      let o = 0;
      for (const k of keep) {
        stripped.set(k, o);
        o += k.length;
      }
      jpeg = stripped;
    }
    let at = 2;
    if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
    const total = segs.reduce((n, s) => n + s.length, 0);
    const out = new Uint8Array(jpeg.length + total);
    out.set(jpeg.subarray(0, at));
    let o = at;
    for (const s of segs) {
      out.set(s, o);
      o += s.length;
    }
    out.set(jpeg.subarray(at), o);
    return out;
  }

  /** Median colour of the middle of the photo. Only a suggestion for the small dot and the swatch. */
  function centreColour(bitmap) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d', { willReadFrequently: true });
    const w = bitmap.width;
    const h = bitmap.height;
    g.drawImage(bitmap, w / 4, h / 4, w / 2, h / 2, 0, 0, 64, 64);
    const px = g.getImageData(0, 0, 64, 64).data;
    const ch = [[], [], []];
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) ch[k].push(px[i + k]);
    const med = ch.map((a) => a.sort((x, y) => x - y)[a.length >> 1]);
    return '#' + med.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  async function prepare(file) {
    if (file.size > MAX_UPLOAD) throw new StoreError('That photo is too large (over 40 MB). Choose a smaller one.');
    // Read the file once and work from the copy: a photo from Android's picker may not be readable a second time.
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      throw new StoreError('Could not open that photo. Choose it again, or try another one.');
    }
    let bitmap;
    try {
      // colorSpaceConversion 'none' keeps the photo's own pixel values; its colour profile is copied below,
      // so the result looks exactly like the original. imageOrientation applies the phone's rotation.
      bitmap = await createImageBitmap(new Blob([bytes], { type: file.type || 'image/jpeg' }), { colorSpaceConversion: 'none', imageOrientation: 'from-image' });
    } catch {
      throw new StoreError('That file is not a photo the editor can read. Choose a JPG or PNG photo.');
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff'; // transparent parts of PNGs become white, as on the website
    g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, 0, 0, w, h);
    const hex = centreColour(canvas);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new StoreError('Could not prepare that photo. Try another one.');
    const icc = jpegIcc(bytes).length ? jpegIcc(bytes) : await pngIcc(bytes);
    const jpeg = withIcc(new Uint8Array(await blob.arrayBuffer()), icc);
    return { jpeg, width: w, height: h, hex };
  }

  async function draftPhoto(pid) {
    const blob = await idb('readonly', (s) => s.get(pid));
    if (!blob) throw new StoreError('A new photo is missing from this device. Choose the photo again.');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /* ---------- checks before publishing (anything that would break the website build) ---------- */

  const isInt = (n) => Number.isInteger(n);

  function validateCategories(c) {
    if (!c || !Array.isArray(c.groups) || typeof c.categories !== 'object')
      throw new StoreError('Something went wrong with the product categories. Press "Get latest" and try again.');
    const seen = new Set();
    for (const g of c.groups) {
      if (!(g.title || '').trim()) throw new StoreError('A group has no name.');
      for (const id of g.categories) {
        if (!c.categories[id]) throw new StoreError(`Group "${g.title}" lists a category that does not exist.`);
        if (seen.has(id)) throw new StoreError(`"${c.categories[id].title}" is in two groups.`);
        seen.add(id);
      }
    }
    for (const [id, cat] of Object.entries(c.categories)) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || RESERVED.has(id)) throw new StoreError(`"${cat.title}" has a web address the website cannot use.`);
      if (!seen.has(id)) throw new StoreError(`"${cat.title}" is not in any group.`);
      if (!(cat.title || '').trim()) throw new StoreError('A category has no name.');
      if (!(cat.short || '').trim()) throw new StoreError(`"${cat.title}" has no short name.`);
      const noTemps = cat.min === null && cat.max === null;
      if (!noTemps && !(isInt(cat.min) && isInt(cat.max) && cat.min < cat.max))
        throw new StoreError(`"${cat.title}": the lowest firing temperature must be below the highest.`);
      if (!Array.isArray(cat.types) || !Array.isArray(cat.points) || !Array.isArray(cat.notes))
        throw new StoreError(`"${cat.title}" is incomplete. Press "Get latest" and try again.`);
      for (const t of cat.types) {
        if (!(t.label || '').trim()) throw new StoreError(`"${cat.title}" has a type with no name.`);
        if ((t.min ?? null) !== null || (t.max ?? null) !== null)
          if (!(isInt(t.min) && isInt(t.max) && t.min < t.max)) throw new StoreError(`"${cat.title}", type "${t.label}": check its temperatures.`);
      }
    }
  }

  function validateProducts(path, list, cat, id) {
    if (!Array.isArray(list)) throw new StoreError('Something went wrong with the colour list. Press "Get latest" and try again.');
    const types = new Set(cat.types.length ? cat.types.map((t) => t.id) : [id]);
    list.forEach((item, i) => {
      const name = (item.name || '').trim();
      if (!name) throw new StoreError(`Colour number ${i + 1} in ${cat.title} has no name.`);
      if (!STOCK.has(item.stock)) throw new StoreError(`"${name}" has no stock status.`);
      if (!HEX.test(item.hex || '')) throw new StoreError(`"${name}" has no swatch colour.`);
      if (!types.has(item.range)) throw new StoreError(`"${name}" has no type. Open it and choose one.`);
      if (item.image !== null && item.image !== undefined && (typeof item.image !== 'string' || !item.image))
        throw new StoreError(`"${name}" has a broken photo. Choose the photo again.`);
      if (cat.layout === 'grades' && !(item.purity || '').trim()) throw new StoreError(`"${name}" has no purity.`);
      if (cat.layout !== 'grades' && cat.code === 'required' && !(item.code || '').trim()) throw new StoreError(`"${name}" has no code.`);
    });
  }

  function validate(path, content, categories) {
    if (path === FIXED.categories) return validateCategories(content);
    if (path === FIXED.gallery) {
      if (!Array.isArray(content)) throw new StoreError('Something went wrong with the gallery. Press "Get latest" and try again.');
      content.forEach((item, i) => {
        if (!item.image) throw new StoreError(`Gallery photo ${i + 1} has no photo.`);
        if (!(item.caption || '').trim()) throw new StoreError(`Gallery photo ${i + 1} has no caption.`);
        if (!GALLERY_CATEGORIES.has(item.category)) throw new StoreError(`Gallery photo "${item.caption}" has no category.`);
      });
      return;
    }
    if (path === FIXED.site) {
      const needed = ['name', 'phones', 'whatsapp', 'emails', 'hours', 'address'];
      if (!content || typeof content !== 'object' || needed.some((k) => !(k in content)))
        throw new StoreError('Contact details are incomplete. Press "Get latest" and try again.');
      if (!/^\d{10,15}$/.test(String(content.whatsapp)))
        throw new StoreError('The WhatsApp number should be digits only, with the country code (for example 919897135970).');
      for (const p of content.phones)
        if (!(p.display || '').trim() || !/^\+\d{10,15}$/.test(p.tel || ''))
          throw new StoreError('Each phone number needs digits with the country code (for example +91 98971 35970).');
      return;
    }
    const id = (path.match(/^src\/data\/([a-z0-9-]+)\.json$/) || [])[1];
    const cat = id && categories.categories[id];
    if (!cat) throw new StoreError('The editor tried to change a file it is not allowed to change.');
    validateProducts(path, content, cat, id);
  }

  /* ---------- routes (same names as the old local server) ---------- */

  const routes = {
    async '/api/state'() {
      return { configured: !!token(), local: practice, practice, settings: settings(), draft: !!ls.get('draft') };
    },

    async '/api/setup'(body) {
      const tok = (body.token || '').trim() || ls.get('token') || '';
      const repo = (body.repo || '').trim();
      const branch = (body.branch || '').trim();
      const siteUrl = (body.site_url || '').trim().replace(/\/+$/, '');
      if (!tok) throw new StoreError('Paste the GitHub key first.');
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new StoreError('The repository should look like owner/name.');
      if (!branch) throw new StoreError('Enter the branch name (usually main).');
      if (!/^https?:\/\//.test(siteUrl)) throw new StoreError('The website address should start with https://');
      const api = (local && settings().api) || API;
      await new GitHubStore(tok, repo, branch, api).check();
      ls.set('token', tok);
      ls.set('settings', JSON.stringify({ ...JSON.parse(ls.get('settings') || '{}'), repo, branch, site_url: siteUrl }));
      return routes['/api/state']();
    },

    async '/api/forget'() {
      ls.del('token');
      return routes['/api/state']();
    },

    async '/api/load'() {
      const st = store();
      const files = {};
      const read = async (path, empty) => {
        try {
          files[path] = await st.readJson(path);
        } catch (e) {
          if (e.status !== 404) throw e;
          files[path] = { content: empty, sha: null };
        }
      };
      await read(FIXED.categories, { groups: [], categories: {} });
      const ids = Object.keys(files[FIXED.categories].content.categories || {});
      await Promise.all([read(FIXED.gallery, []), read(FIXED.site, {}), ...ids.map((id) => read(`src/data/${id}.json`, []))]);
      let draft = null;
      try {
        draft = JSON.parse(ls.get('draft') || 'null');
      } catch {}
      // Make the draft's new photos showable again.
      const keys = await idb('readonly', (s) => s.getAllKeys()).catch(() => []);
      await Promise.all(
        (keys || []).filter((k) => !urls.has(k)).map(async (k) => {
          const blob = await idb('readonly', (s) => s.get(k));
          if (blob) urls.set(k, URL.createObjectURL(blob));
        }),
      );
      return { files, draft };
    },

    async '/api/draft'(body) {
      ls.set('draft', JSON.stringify(body));
      return { ok: true };
    },

    async '/api/discard'() {
      ls.del('draft');
      await idb('readwrite', (s) => s.clear()).catch(() => {});
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
      return { ok: true };
    },

    async '/api/photo'(file) {
      const p = await prepare(file);
      const pid = crypto.randomUUID().replace(/-/g, '');
      const blob = new Blob([p.jpeg], { type: 'image/jpeg' });
      await idb('readwrite', (s) => s.put(blob, pid));
      urls.set(pid, URL.createObjectURL(blob));
      return { id: pid, hex: p.hex, width: p.width, height: p.height };
    },

    async '/api/publish'(body) {
      const files = body.files || {};
      const base = body.baseShas || {};
      const message = (body.message || 'Website update').trim().slice(0, 2000);
      if (!Object.keys(files).length) throw new StoreError('There is nothing to publish.');
      const categories = files[FIXED.categories] || body.categories;
      const out = {};
      const moved = new Map();
      const place = async (img, folder, label) => {
        if (typeof img !== 'string' || !img.startsWith('draft:')) return img;
        const pid = img.slice(6);
        const rel = `resources/${folder}/${slug(label)}-${pid.slice(0, 6)}.jpg`;
        out[`src/assets/${rel}`] = await draftPhoto(pid);
        moved.set(rel, pid);
        return rel;
      };
      for (const [path, content] of Object.entries(files)) {
        if (!/^src\/data\/[a-z0-9-]+\.json$/.test(path)) throw new StoreError('The editor tried to change a file it is not allowed to change.');
        if (path === FIXED.categories) {
          for (const [id, cat] of Object.entries(content.categories)) cat.image = await place(cat.image, cat.folder || id, `category ${cat.short || id}`);
        } else if (path === FIXED.gallery) {
          for (const item of content) item.image = await place(item.image, 'gallery', item.caption || '');
        } else if (path !== FIXED.site) {
          const id = path.slice(9, -5);
          const cat = categories.categories[id];
          for (const item of content || [])
            item.image = await place(item.image, cat?.folder || id, `${item.code || item.purity || ''} ${item.name || ''}`);
        }
        validate(path, content, categories);
        out[path] = utf8.encode(dumpJson(content));
      }
      const shas = {};
      for (const p of Object.keys(files)) if (base[p]) shas[p] = base[p];
      const result = await store().commit(out, message, shas);
      for (const [rel, pid] of moved) {
        published.set(rel, urls.get(pid));
        urls.delete(pid); // keep the object URL alive for the published path
      }
      await routes['/api/discard']();
      return result;
    },

    async '/api/deploy'(_, query) {
      return { status: await store().deployStatus(query.get('sha') || '') };
    },

    async '/api/open'(body) {
      const url = body.url || '';
      const allowed = [settings().site_url, 'https://github.com/'];
      if (!allowed.some((a) => url.startsWith(a))) throw new StoreError('That link is not allowed.');
      // In the Android app, leaving the app's own pages opens the phone's browser instead.
      if (window.Capacitor?.isNativePlatform?.()) location.href = url;
      else window.open(url, '_blank', 'noopener');
      return { ok: true };
    },
  };

  return {
    practice,
    reserved: RESERVED,
    slug,
    /** Same contract as fetch-ing the old local server: resolves with data, or throws an Error with .status/.conflict. */
    async call(path, body) {
      const [route, qs] = path.split('?');
      const fn = routes[route];
      if (!fn) throw new StoreError('Not found.', 404);
      try {
        return await fn(body ?? {}, new URLSearchParams(qs || ''));
      } catch (e) {
        if (e instanceof StoreError) throw e;
        console.error(`${e?.name}: ${e?.message}`, e?.stack);
        throw new StoreError('Something went wrong inside the editor. Close it and open it again.', 500);
      }
    },
    /** Address for showing a photo: a new photo kept on this device, or one already on the website. */
    photoUrl(image) {
      if (!image) return '';
      if (image.startsWith('draft:')) return urls.get(image.slice(6)) || '';
      if (published.has(image)) return published.get(image);
      const s = settings();
      return `https://raw.githubusercontent.com/${s.repo}/${encodeURIComponent(s.branch)}/src/assets/${encPath(image)}`;
    },
    /** Kept in localStorage, so it is safe to call while the page is closing. */
    saveDraftNow(body) {
      try {
        ls.set('draft', JSON.stringify(body));
      } catch {}
    },
  };
})();
