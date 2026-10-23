// The four product lines. Shared by the nav, home page, products page and catalogue pages.
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
  filters: { id: string; label: string }[];
}

export const lines: Line[] = [
  {
    id: 'gold',
    href: '/gold.html',
    title: 'Liquid Gold & Platinum',
    short: 'Liquid gold',
    firing: '500 to 830°C',
    min: 500,
    max: 830,
    summary: 'Bright and burnished gold and platinum in 7%, 10%, 12% and custom purity, for glass and ceramic.',
    filters: [
      { id: 'gold', label: 'Gold' },
      { id: 'platinum', label: 'Platinum' },
    ],
  },
  {
    id: 'luster',
    href: '/luster.html',
    title: 'Liquid Lustre Colours',
    short: 'Lustre colours',
    firing: '750 to 850°C',
    min: 750,
    max: 850,
    summary: 'Metallic and pearl lustres with stable viscosity and an even sheen across firing cycles.',
    filters: [
      { id: 'non-gold', label: 'Standard' },
      { id: 'gold-based', label: 'Gold based' },
      { id: 'medium', label: 'Medium' },
    ],
  },
  {
    id: 'ceramic',
    href: '/ceramic.html',
    title: 'Ceramic & Glass Colours',
    short: 'Ceramic colours',
    firing: '500 to 830°C',
    min: 500,
    max: 830,
    summary: 'Imported on-glaze and glass colours for third-firing decoration, with sharp shades and high gloss.',
    filters: [
      { id: 'on-glaze', label: 'On-glaze 760 to 830°C' },
      { id: 'glass', label: 'Glass 500 to 560°C' },
    ],
  },
  {
    id: 'inglaze',
    href: '/inglaze.html',
    title: 'In-Glaze Colours',
    short: 'In-glaze colours',
    firing: '1050 to 1150°C',
    min: 1050,
    max: 1150,
    summary: 'High-temperature colours that fuse into the glaze for scratch resistance and lasting depth.',
    filters: [],
  },
];

export const lineById = Object.fromEntries(lines.map((l) => [l.id, l])) as Record<LineId, Line>;
