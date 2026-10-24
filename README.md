# Shri Vijay Enterprises

Website for श्री Vijay Enterprises, Agra: https://www.shrivijayenterprises.in

Built with [Astro](https://astro.build) and plain CSS. The build outputs static files, so any free static host can serve it.

## Run locally

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # writes the site to dist/
```

## Editing content

| What | File |
| --- | --- |
| Phone, email, address, hours, WhatsApp number | `src/data/site.json` |
| Ceramic & glass colours | `src/data/ceramic.json` |
| Lustre colours | `src/data/luster.json` |
| Liquid gold & platinum | `src/data/gold.json` |
| In-glaze colours | `src/data/inglaze.json` (while empty, the page shows a "range being added" placeholder) |
| Gallery photos and captions | `src/data/gallery.json` |
| Product and gallery photos | `src/assets/resources/<Range>/` |
| Home page shade card picks | `featured` in `src/lib/shades.ts` |

Each product entry: `name`, `code` (or `purity` for gold), `hex` (approximate screen colour), `image` (path under `src/assets/`, or `null` to show a colour swatch), `stock` (`in`, `low` or `out`), `range` (filter group).

Gold and platinum entries with the same `name` are shown as one product with a button per purity grade.
If two products share one photo, the one whose `code` matches the file name owns it; the others are labelled "Photo shows a similar shade".

Gallery entry: `image` (path under `src/assets/`), `caption`, `category` (`gold`, `lustre`, `glass`, `ceramic` or `packing`).

Product photos must be real photos. Do not use AI-generated or recoloured images of shades.

## Brand files

- `public/brand/emblem.svg`: the logo emblem as a sharp vector, redrawn from the original.
- `public/og.png`: the picture shown when the site link is shared (WhatsApp, Google, etc.).
- `public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-512.png`: browser and phone icons.
