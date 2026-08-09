import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  adapter: cloudflare(),
  integrations: [react()],
  build: {
    inlineStylesheets: 'always' // Inline all CSS to prevent render blocking
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@components': '/src/components',
        '@layouts': '/src/layouts'
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Split syntax highlighter into a separate chunk.
            if (id.includes('react-syntax-highlighter')) return 'syntax-highlighter';
          }
        }
      },
      // Increase chunk size warning limit (636 KB unminified, but only 230 KB gzipped)
      chunkSizeWarningLimit: 700
    }
  }
});
