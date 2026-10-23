import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';

export default defineConfig({
  site: 'https://www.shrivijayenterprises.in',
  // Keep the old URLs (/aboutus.html, /ceramic.html ...) so existing Google results and shared links still work.
  build: { format: 'file' },
  trailingSlash: 'never',
  integrations: [react(), sitemap(), icon({ include: { ph: ['*'] } })],
});
