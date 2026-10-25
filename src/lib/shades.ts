import { getImage } from 'astro:assets';
import { lineById, lines, productsOf, temps, type LineId } from '../data/lines';
import { productImage } from './images';
import { waLink } from './links';

interface Raw {
  name: string;
  code?: string;
  purity?: string;
  hex: string;
  image?: string | null;
  stock: string;
  range: string;
}

export interface Shade {
  id: string;
  line: LineId;
  name: string;
  code?: string;
  hex: string;
  img: string | null;
  chip: string | null;
  /** Set when the photo actually shows another, similar shade. */
  photoNote?: string;
  stock: string;
  range: string;
  rangeLabel: string;
  firing: string;
  href: string;
  enquire: string;
}

export interface GoldProduct {
  id: string;
  name: string;
  img: string | null;
  range: string;
  grades: { purity: string; stock: string; enquire: string }[];
}

const data = (line: LineId) => productsOf(line) as Raw[];

// Firing range per product: from its type when the type has its own (glass, on-glaze), else the whole line's.
const firingFor = (line: LineId, r: Raw) => {
  const t = lineById[line].types.find((x) => x.id === r.range);
  return t?.note || temps(t?.min, t?.max) || lineById[line].firing;
};

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function webp(path: string | null | undefined, size: number) {
  const src = productImage(path);
  if (!src) return null;
  const w = Math.min(size, src.width, src.height);
  const img = await getImage({ src, width: w, height: w, fit: 'cover', format: 'webp', quality: 78 });
  return img.src;
}

const stem = (path: string) => path.split('/').pop()!.replace(/\.[^.]+$/, '');

/**
 * Some products reuse another product's photo. The photo "belongs" to the product whose code matches the
 * file name (3470.jpeg belongs to 3470), otherwise to the first product using it. Others get a note.
 */
function photoNotes(items: Raw[]) {
  const notes = new Map<Raw, string>();
  const byImage = new Map<string, Raw[]>();
  items.forEach((r) => r.image && byImage.set(r.image, [...(byImage.get(r.image) ?? []), r]));
  for (const [image, users] of byImage) {
    if (users.length < 2) continue;
    const owner = users.find((u) => u.code === stem(image)) ?? users[0];
    const label = owner.code ? `${owner.code} ${owner.name}` : owner.name;
    users.filter((u) => u !== owner).forEach((u) => notes.set(u, `Photo shows a similar shade, ${label}`));
  }
  return notes;
}

const gradeGroupId = (line: LineId, name: string) => `${line}-${slug(name)}`;

export async function shadesFor(line: LineId): Promise<Shade[]> {
  const l = lineById[line];
  const labels = Object.fromEntries(l.types.map((t) => [t.id, t.label]));
  const notes = photoNotes(data(line));
  const grades = l.layout === 'grades';
  return Promise.all(
    data(line).map(async (r) => {
      const code = r.code ?? r.purity;
      const id = grades ? gradeGroupId(line, r.name) : `${line}-${slug(code ? `${code}-${r.name}` : r.name)}`;
      return {
        id,
        line,
        name: r.name,
        code,
        hex: r.hex,
        img: await webp(r.image, 640),
        chip: await webp(r.image, 280),
        photoNote: notes.get(r),
        stock: r.stock,
        range: r.range,
        rangeLabel: labels[r.range] ?? '',
        firing: firingFor(line, r),
        href: `${l.href}#${id}`,
        enquire: waLink(`Hello, I would like to enquire about ${l.short}: ${r.name}${code ? ` (${code})` : ''}.`),
      };
    }),
  );
}

export const allShades = async () => (await Promise.all(lines.map((l) => shadesFor(l.id)))).flat();

/** Products sold by purity grade (liquid gold and platinum): one card per product with its grades. */
export async function goldProducts(line: LineId = 'gold'): Promise<GoldProduct[]> {
  const groups = new Map<string, Raw[]>();
  data(line).forEach((r) => groups.set(r.name, [...(groups.get(r.name) ?? []), r]));
  return Promise.all(
    [...groups].map(async ([name, rows]) => ({
      id: gradeGroupId(line, name),
      name,
      img: await webp(rows.find((r) => r.image)?.image, 720),
      range: rows[0].range,
      grades: rows.map((r) => ({
        purity: r.purity ?? '',
        stock: r.stock,
        enquire: waLink(`Hello, I would like to enquire about ${name}, ${r.purity} purity.`),
      })),
    })),
  );
}

/** Hand-picked chips for the home page shade card: one per colour family, real photos only. */
export const featured: { line: LineId; key: string }[] = [
  { line: 'ceramic', key: '3589' },
  { line: 'luster', key: 'Rose Pink' },
  { line: 'ceramic', key: 'SF25' },
  { line: 'gold', key: '7%' },
  { line: 'ceramic', key: '3130' },
  { line: 'luster', key: 'Parrot Green' },
  { line: 'ceramic', key: '3470' },
  { line: 'luster', key: 'Bronze' },
  { line: 'ceramic', key: '3181' },
  { line: 'luster', key: 'Blue' },
  { line: 'ceramic', key: '3149' },
  { line: 'luster', key: 'Golden Yellow' },
];

export async function featuredShades() {
  const all = await allShades();
  return featured
    .map(({ line, key }) => all.find((s) => s.line === line && (s.code === key || s.name === key) && s.chip && !s.photoNote))
    .filter((s): s is Shade => Boolean(s));
}
