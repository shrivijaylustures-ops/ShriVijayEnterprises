import { useMemo, useState } from 'react';
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

/**
 * Product grid with filter chips and search.
 * items: { name, code?, hex, img?, stock, range, rangeLabel, firing, enquire }
 */
export default function Catalogue({ items, filters = [], noun = 'shades' }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

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
        <div className="search">
          <label htmlFor="cat-q">Search by name or code</label>
          <input id="cat-q" type="search" placeholder="e.g. 3589 or cobalt" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </div>
      </div>

      <p className="cat-count num" aria-live="polite">
        Showing {shown.length} of {items.length} {noun}
      </p>

      {shown.length === 0 ? (
        <div className="cat-empty">
          <p className="cat-empty-h">No {noun} match "{query}"</p>
          <p>Try another code, or ask us directly. We stock more shades than we list here.</p>
          <button type="button" className="chip" onClick={() => (setQuery(''), setFilter('all'))}>
            Clear search
          </button>
        </div>
      ) : (
        <ul className="grid">
          {shown.map((i) => (
            <li key={`${i.name}-${i.code}-${i.range}`} className="card">
              <div className="card-media" style={{ '--swatch': i.hex }}>
                {i.img ? (
                  <img src={i.img} alt={`${i.name}${i.code ? ` ${i.code}` : ''}`} loading="lazy" decoding="async" width="640" height="640" />
                ) : (
                  <div className="swatch" role="img" aria-label={`Colour swatch for ${i.name}`}>
                    {i.code && (
                      <span className="swatch-code" style={{ color: inkFor(i.hex) }}>
                        {i.code}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="card-body">
                <div className="card-top">
                  <h3 className="card-name">{i.name}</h3>
                  {i.code && <span className="card-code num">{i.code}</span>}
                </div>
                <p className="card-meta">
                  <span className="dot-hex" style={{ background: i.hex }} aria-hidden="true" />
                  {i.rangeLabel}
                  <span className="sep" aria-hidden="true" />
                  <span className="num">{i.firing}</span>
                </p>
                <div className="card-foot">
                  <span className={`stock ${STOCK[i.stock]?.cls}`}>{STOCK[i.stock]?.label}</span>
                  <a className="enquire" href={i.enquire} target="_blank" rel="noopener">
                    <WhatsappLogo aria-hidden="true" /> Enquire
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
