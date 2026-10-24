import { useEffect, useMemo, useState } from 'react';
import { WhatsappLogo } from '@phosphor-icons/react/dist/ssr';
import './catalogue.css';

const STOCK = {
  in: { label: 'In stock', cls: 'ok' },
  low: { label: 'Low stock', cls: 'warn' },
  out: { label: 'On order', cls: 'out' },
};

// Black or white label, whichever reads better on the swatch colour.
const inkFor = (hex) => {
  const n = parseInt((hex || '#888').slice(1).padEnd(6, '0'), 16);
  const lum = 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? '#1c1a17' : '#f7f4ee';
};

// Real photo if we have one, otherwise a colour tile with the code (screen colour only).
function Swatch({ s, small }) {
  const src = small ? s.chip : s.img;
  if (src) {
    const size = small ? 280 : 640;
    return <img src={src} alt={`${s.name}${s.code ? ` ${s.code}` : ''}`} loading="lazy" decoding="async" width={size} height={size} />;
  }
  return (
    <div className="swatch" style={{ '--swatch': s.hex }} role="img" aria-label={`Approximate colour of ${s.name}, no photo yet`}>
      {s.code && !small && (
        <span className="swatch-code" style={{ color: inkFor(s.hex) }} translate="no">
          {s.code}
        </span>
      )}
    </div>
  );
}

// Filter, search and layout live in the URL so a filtered list can be shared (?type=glass&q=3589&view=list).
function readState() {
  const p = new URLSearchParams(window.location.search);
  let view = p.get('view');
  if (!view) {
    try {
      view = localStorage.getItem('sve-view');
    } catch {}
  }
  return { type: p.get('type') || 'all', q: p.get('q') || '', view: view === 'list' ? 'list' : 'grid' };
}

/** Product grid or list, with type filter and search by name or code. */
export default function Catalogue({ items, filters = [], noun = 'shades' }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('grid');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const s = readState();
    setFilter(s.type);
    setQuery(s.q);
    setView(s.view);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const p = new URLSearchParams(window.location.search);
    filter === 'all' ? p.delete('type') : p.set('type', filter);
    query.trim() ? p.set('q', query.trim()) : p.delete('q');
    view === 'list' ? p.set('view', 'list') : p.delete('view');
    const qs = p.toString();
    history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    try {
      localStorage.setItem('sve-view', view);
    } catch {}
  }, [filter, query, view, ready]);

  const counts = useMemo(() => {
    const c = { all: items.length };
    items.forEach((i) => (c[i.range] = (c[i.range] || 0) + 1));
    return c;
  }, [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (i) => (filter === 'all' || i.range === filter) && (!q || i.name.toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q)),
    );
  }, [items, filter, query]);

  const usable = filters.filter((f) => counts[f.id]);

  return (
    <div className="cat">
      <div className="cat-tools">
        {usable.length > 1 && (
          <div className="chips" role="group" aria-label="Filter by type">
            {[{ id: 'all', label: 'All' }, ...usable].map((f) => (
              <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} <span className="chip-n num">{counts[f.id]}</span>
              </button>
            ))}
          </div>
        )}
        <div className="tools-right">
          <div className="search">
            <label htmlFor="cat-q">Search by name or code</label>
            <input
              id="cat-q"
              name="q"
              type="search"
              placeholder="e.g. 3589 or cobalt…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="view-toggle" role="group" aria-label="Layout">
            <button type="button" className="chip" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
              Cards
            </button>
            <button type="button" className="chip" aria-pressed={view === 'list'} onClick={() => setView('list')}>
              List
            </button>
          </div>
        </div>
      </div>

      <p className="cat-count num" aria-live="polite">
        Showing {shown.length} of {items.length} {items.length === 1 ? noun.replace(/s$/, '') : noun}
      </p>

      {shown.length === 0 ? (
        <div className="cat-empty">
          <p className="cat-empty-h">No {noun} match “{query}”</p>
          <p>Try another code, or ask us directly. We stock more shades than we list here.</p>
          <button type="button" className="chip" onClick={() => (setQuery(''), setFilter('all'))}>
            Clear search
          </button>
        </div>
      ) : view === 'grid' ? (
        <ul className="grid">
          {shown.map((s) => (
            <li key={s.id} id={s.id} className="card">
              <div className="card-media">
                <Swatch s={s} />
              </div>
              <div className="card-body">
                <div className="card-top">
                  <h3 className="card-name">{s.name}</h3>
                  {s.code && (
                    <span className="card-code num" translate="no">
                      {s.code}
                    </span>
                  )}
                </div>
                <p className="card-meta">
                  <span className="dot-hex" style={{ background: s.hex }} aria-hidden="true" />
                  {s.rangeLabel}
                  {s.rangeLabel && <span className="sep" aria-hidden="true" />}
                  <span className="num">{s.firing}</span>
                </p>
                {s.photoNote && <p className="card-note">{s.photoNote}</p>}
                <div className="card-foot">
                  <span className={`stock ${STOCK[s.stock]?.cls}`}>{STOCK[s.stock]?.label}</span>
                  <a className="enquire" href={s.enquire} target="_blank" rel="noopener" aria-label={`Enquire about ${s.name}${s.code ? ` ${s.code}` : ''} on WhatsApp`}>
                    <WhatsappLogo aria-hidden="true" /> Enquire
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Shade</th>
                <th scope="col">Code</th>
                <th scope="col">Type</th>
                <th scope="col">Firing</th>
                <th scope="col">Stock</th>
                <th scope="col">
                  <span className="sr">Enquire</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} id={s.id}>
                  <td>
                    <span className="t-shade">
                      <span className="t-sw">
                        <Swatch s={s} small />
                      </span>
                      {s.name}
                    </span>
                  </td>
                  <td className="t-code num" translate="no">
                    {s.code || '-'}
                  </td>
                  <td>{s.rangeLabel || '-'}</td>
                  <td className="t-nowrap num">{s.firing}</td>
                  <td className={`stock ${STOCK[s.stock]?.cls}`}>{STOCK[s.stock]?.label}</td>
                  <td>
                    <a className="enquire" href={s.enquire} target="_blank" rel="noopener" aria-label={`Enquire about ${s.name}${s.code ? ` ${s.code}` : ''} on WhatsApp`}>
                      <WhatsappLogo aria-hidden="true" /> Enquire
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
