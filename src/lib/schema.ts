// Structured data (schema.org JSON-LD) that tells Google and AI search tools, in machine-readable form,
// who the business is and what it sells. Built from the same data files the editor changes.
import site from '../data/site.json';
import { lines } from '../data/lines';

const SITE = 'https://www.shrivijayenterprises.in';
export const ORG_ID = `${SITE}/#business`;

export function businessSchema() {
  return {
    '@type': ['LocalBusiness', 'Organization'],
    '@id': ORG_ID,
    name: `${site.nameHindi} Vijay Enterprises`,
    alternateName: [site.name, 'Vijay Enterprises', 'Spectrum India'],
    description:
      'Manufacturer of liquid lustre colours and liquid gold and platinum lustre, and importer of ceramic on-glaze, glass and in-glaze colours, for glass and ceramic decoration. Agra, India, since 1975.',
    url: `${SITE}/`,
    logo: `${SITE}/icon-512.png`,
    image: `${SITE}/og.png`,
    telephone: site.phones[0].tel,
    email: site.emails[0],
    foundingDate: String(site.founded),
    founder: { '@type': 'Person', name: 'Umesh Agarwal' },
    employee: { '@type': 'Person', name: 'Hemant Agarwal', jobTitle: 'Managing Director' },
    address: {
      '@type': 'PostalAddress',
      streetAddress: `${site.address.line1}, ${site.address.line2}`,
      addressLocality: 'Agra',
      addressRegion: 'Uttar Pradesh',
      postalCode: '282005',
      addressCountry: 'IN',
    },
    geo: { '@type': 'GeoCoordinates', latitude: 27.21535, longitude: 78.01306 },
    hasMap: site.mapsLink,
    openingHours: 'Mo-Su 10:00-21:00',
    areaServed: { '@type': 'Country', name: 'India' },
    knowsAbout: [
      'Liquid lustre colours',
      'Liquid gold',
      'Liquid platinum lustre',
      'On-glaze ceramic colours',
      'Glass colours',
      'In-glaze ceramic colours',
      'Ceramic decoration',
      'Glass decoration',
      'Third firing decoration',
    ],
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Products',
      itemListElement: lines.map((l) => ({
        '@type': 'OfferCatalog',
        name: l.title,
        description: `${l.summary} Firing range ${l.firing}.`,
        url: `${SITE}${l.href}`,
      })),
    },
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'sales',
      telephone: site.phones[0].tel,
      email: site.emails[0],
      availableLanguage: ['English', 'Hindi'],
    },
  };
}

export function websiteSchema() {
  return { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: site.name, publisher: { '@id': ORG_ID }, inLanguage: 'en-IN' };
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE}${it.path}` })),
  };
}

export function faqSchema(faq: { q: string; a: string }[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}
