import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The website editor (editor/ui) is published with the site at /editor/, so it can be opened in any browser,
// installed as an app on Windows, and wrapped as the Android app. It is plain files; nothing to build.
const editor = {
  name: 'sve-editor',
  hooks: {
    'astro:build:done': ({ dir }) => cpSync(fileURLToPath(new URL('./editor/ui', import.meta.url)), fileURLToPath(new URL('./editor', dir)), { recursive: true }),
  },
};

export default defineConfig({
  site: 'https://www.shrivijayenterprises.in',
  // Keep the old URLs (/aboutus.html, /ceramic.html ...) so existing Google results and shared links still work.
  build: { format: 'file' },
  trailingSlash: 'never',
  integrations: [react(), sitemap(), icon({ include: { ph: ['*'] } }), editor],
});
