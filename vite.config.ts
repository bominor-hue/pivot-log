import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build` makes the installable offline app (dist/). `npm run build:preview` makes one
// self-contained HTML file for a quick look (no offline install), used for the claude.ai preview.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    mode === 'single'
      ? viteSingleFile()
      : VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'templates/*.xlsx'],
          manifest: {
            name: 'Pivot Log', short_name: 'Pivot Log', description: 'Irrigation runs, water balance and records',
            theme_color: '#0E6BA8', background_color: '#f2f5f4', display: 'standalone', start_url: './',
            icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
          },
          workbox: { globPatterns: ['**/*.{js,css,html,svg,png,json,xlsx}'], maximumFileSizeToCacheInBytes: 5_000_000 },
        }),
  ],
  build: mode === 'single' ? { outDir: 'dist-preview' } : {},
  test: { environment: 'node' },
}))
