// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // Served from a custom subdomain (GitHub Pages + public/CNAME).
  site: 'https://vibecamp.mahan.io',
  // Inline all CSS into the HTML so the built dist/index.html works when
  // opened directly from disk (file://), not just when served.
  build: {
    inlineStylesheets: 'always',
  },
});
