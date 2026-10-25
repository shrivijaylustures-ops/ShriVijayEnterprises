// Product categories ("lines") and the groups they are shown in. Shared by the nav, home page, products page,
// catalogue pages, sitemap and llms.txt. Everything comes from categories.json, which the editor app changes:
// a new category there gets its own page at /<id> without any code change.
import data from './categories.json';

export type LineId = string;

export interface LineType {
  id: string;
  label: string;
  min?: number;
  max?: number;
  /** Shown instead of a temperature, for example "Oil base". */
  note?: string;
}

interface RawLine {
  title: string;
  short: string;
  min: number | null;
  max: number | null;
  summary: string;
  points: string[];
  notes: string[];
  description?: string;
  image?: string | null;
  folder?: string;
  /** 'grades': sold by purity, one card per product (liquid gold). 'shades': one card per colour. */
  layout?: 'shades' | 'grades';
  code?: 'required' | 'optional';
  types?: LineType[];
  hidden?: boolean;
  builtIn?: boolean;
}

export interface Line {
  id: LineId;
  href: string;
  group: string;
  title: string;
  short: string;
  /** "500 to 830°C", or '' when the category has no firing temperature yet. */
  firing: string;
  min: number | null;
  max: number | null;
  summary: string;
  description: string;
  points: string[];
  notes: string[];
  image: string | null;
  layout: 'shades' | 'grades';
  filters: { id: string; label: string }[];
  types: LineType[];
}

export interface Group {
  id: string;
  title: string;
  lines: Line[];
}

export const temps = (min?: number | null, max?: number | null) =>
  typeof min === 'number' && typeof max === 'number' ? `${min} to ${max}°C` : '';

const raw = data.categories as Record<string, RawLine>;

function toLine(id: string, group: string, r: RawLine): Line {
  const types = r.types ?? [];
  const firing = temps(r.min, r.max);
  return {
    id,
    href: `/${id}`,
    group,
    title: r.title,
    short: r.short || r.title,
    firing,
    min: r.min ?? null,
    max: r.max ?? null,
    summary: r.summary,
    description: r.description || `${r.summary}${firing ? ` Firing range ${firing}.` : ''}`,
    points: r.points ?? [],
    notes: r.notes ?? [],
    image: r.image ?? null,
    layout: r.layout === 'grades' ? 'grades' : 'shades',
    types,
    // Filter chips on the catalogue page, matching the `range` field of each product.
    filters: types.map((t) => ({ id: t.id, label: [t.label, temps(t.min, t.max)].filter(Boolean).join(' ') })),
  };
}

// Groups in their saved order; hidden categories and empty groups are left out of the website.
export const groups: Group[] = data.groups
  .map((g) => ({
    id: g.id,
    title: g.title,
    lines: g.categories.filter((id) => raw[id] && !raw[id].hidden).map((id) => toLine(id, g.title, raw[id])),
  }))
  .filter((g) => g.lines.length > 0);

export const lines: Line[] = groups.flatMap((g) => g.lines);

export const lineById: Record<LineId, Line> = Object.fromEntries(lines.map((l) => [l.id, l]));

// Product lists per category: src/data/<id>.json. A category without a file yet simply has no products.
const files = import.meta.glob<{ default: unknown[] }>('./*.json', { eager: true });
export const productsOf = (id: LineId) => (files[`./${id}.json`]?.default ?? []) as any[];
