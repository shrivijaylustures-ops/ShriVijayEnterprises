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
| In-glaze colours | `src/data/inglaze.json` |
| Product photos | `src/assets/resources/<Range>/` |

Each product entry: `name`, `code` (or `purity` for gold), `hex` (approximate screen colour), `image` (path under `src/assets/`, or `null` to show a colour swatch), `stock` (`in`, `low` or `out`), `range` (filter group).
