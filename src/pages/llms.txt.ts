// /llms.txt: a plain summary of the business and full product list for AI assistants and search tools.
// Generated at build time from the same data files the editor changes, so it is always current.
import type { APIRoute } from 'astro';
import site from '../data/site.json';
import { groups, lines } from '../data/lines';
import { goldProducts, shadesFor } from '../lib/shades';

const SITE = 'https://www.shrivijayenterprises.in';
const STOCK: Record<string, string> = { in: 'in stock', low: 'low stock', out: 'on order' };

export const GET: APIRoute = async () => {
  const out: string[] = [];
  out.push(`# ${site.nameHindi} Vijay Enterprises (Shri Vijay Enterprises)`, '');
  out.push(
    '> Manufacturer of liquid lustre colours and liquid gold and platinum lustre, and importer of on-glaze, glass and in-glaze ceramic colours, for glass and ceramic decoration. Based in Agra, India, since 1975 (founded as Spectrum India; Vijay Enterprises from 2001; Shri Vijay Enterprises from 2025).',
    '',
  );
  out.push('## About', '');
  out.push('- Founded in 1975 by Late Mr. Umesh Agarwal, a metallurgical engineer from IIT Bombay. Run today by Mr. Hemant Agarwal (Managing Director).');
  out.push('- Customers: ceramic manufacturers, glassware producers, decorative ware makers, giftware and tableware brands across India.');
  out.push('- Fired samples are available on request; screen colours are approximate.', '');

  out.push('## Product ranges', '');
  for (const g of groups) {
    out.push(`### ${g.title}`, '');
    for (const l of g.lines) out.push(`- [${l.title}](${SITE}${l.href}): ${l.summary}${l.firing ? ` Firing range ${l.firing}.` : ''}`);
    out.push('');
  }

  for (const l of lines) {
    out.push(`## ${l.title}${l.firing ? ` (${l.firing})` : ''}`, '');
    if (l.layout === 'grades') {
      for (const p of await goldProducts(l.id)) {
        out.push(`- ${p.name}: purity ${p.grades.map((g) => `${g.purity}${g.stock !== 'in' ? ` (${STOCK[g.stock]})` : ''}`).join(', ')}`);
      }
    } else {
      const shades = await shadesFor(l.id);
      if (!shades.length) out.push('- Range being added. Ask for shades by WhatsApp or phone.');
      for (const s of shades) {
        out.push(`- ${s.code ? `${s.code} ` : ''}${s.name}${s.rangeLabel ? `, ${s.rangeLabel.toLowerCase()}` : ''}${s.firing ? `, ${s.firing}` : ''}, ${STOCK[s.stock]}`);
      }
    }
    out.push('');
  }

  out.push('## Contact', '');
  out.push(`- Phone: ${site.phones.map((p) => `${p.display} (${p.label.toLowerCase()})`).join(', ')}`);
  out.push(`- WhatsApp: +${site.whatsapp} (https://wa.me/${site.whatsapp})`);
  out.push(`- Email: ${site.emails.join(', ')}`);
  out.push(`- Address: ${site.address.line1}, ${site.address.line2}, ${site.address.region}, ${site.address.country}`);
  out.push(`- Hours: ${site.hours}`);
  out.push('- To order or ask for a price, send the product code and quantity.', '');

  out.push('## Pages', '');
  for (const [name, path] of [
    ['Home', '/'],
    ['All products', '/products'],
    ['Gallery', '/gallery'],
    ['About us', '/aboutus'],
    ['Contact', '/contact'],
  ])
    out.push(`- [${name}](${SITE}${path})`);
  out.push('');

  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
