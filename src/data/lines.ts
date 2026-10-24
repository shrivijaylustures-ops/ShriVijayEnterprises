// The four product lines. Shared by the nav, home page, products page and catalogue pages.
// The words and temperatures live in ranges.json so they can be changed from the editor app.
import ranges from './ranges.json';

export type LineId = 'gold' | 'luster' | 'ceramic' | 'inglaze';

export interface Line {
  id: LineId;
  href: string;
  title: string;
  short: string;
  firing: string;
  min: number; // lowest firing temperature, °C (for the firing guide)
  max: number;
  summary: string;
  points: string[]; // bullet points on the products page
  notes: string[]; // notes at the top of the range's catalogue page
  filters: { id: string; label: string }[];
}

// Filter groups match the `range` field of each product in the data files.
const filters: Record<LineId, Line['filters']> = {
  gold: [
    { id: 'gold', label: 'Gold' },
    { id: 'platinum', label: 'Platinum' },
  ],
  luster: [
    { id: 'non-gold', label: 'Standard' },
    { id: 'gold-based', label: 'Gold based' },
    { id: 'medium', label: 'Medium' },
  ],
  ceramic: [
    { id: 'on-glaze', label: 'On-glaze 760 to 830°C' },
    { id: 'glass', label: 'Glass 500 to 560°C' },
  ],
  inglaze: [],
};

const order: LineId[] = ['gold', 'luster', 'ceramic', 'inglaze'];

export const lines: Line[] = order.map((id) => ({
  id,
  href: `/${id}`,
  ...ranges[id],
  filters: filters[id],
}));

export const lineById = Object.fromEntries(lines.map((l) => [l.id, l])) as Record<LineId, Line>;
