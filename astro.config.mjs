import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  site: 'https://auchgit.github.io',
  trailingSlash: 'ignore',
  // Styles inside every page: after a deploy, a cached page can't point to a
  // stylesheet that no longer exists (that left pages unstyled).
  build: { format: 'directory', inlineStylesheets: 'always' },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
})
