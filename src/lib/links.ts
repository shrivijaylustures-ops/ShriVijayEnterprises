import site from '../data/site.json';

/** WhatsApp chat link, optionally with a prefilled message. */
export const waLink = (message = 'Hello, I have an enquiry about your products.') =>
  `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(message)}`;

export const mailLink = (subject = 'Product enquiry') => `mailto:${site.emails[0]}?subject=${encodeURIComponent(subject)}`;
