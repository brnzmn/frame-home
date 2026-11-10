import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The TV loads the app from files, where module scripts are refused. Ship one classic script.
function classicScript(): Plugin {
  return {
    name: 'classic-script',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<script defer src="$1"></script>')
        .replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  root: 'app',
  base: './',
  plugins: [classicScript()],
  build: {
    outDir: '../build/app',
    emptyOutDir: true,
    target: 'chrome100',
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'app.js',
        assetFileNames: '[name][extname]',
        inlineDynamicImports: true,
      },
    },
  },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  test: { root: '.', include: ['app/src/**/*.test.ts'] },
});
