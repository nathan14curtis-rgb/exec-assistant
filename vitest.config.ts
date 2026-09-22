import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Wrangler turns a file matched by its `Data` rule into an ArrayBuffer module.
 * Vitest has no such rule, so the same import is served here — otherwise the
 * dashboard tests cannot load the module that serves the favicon.
 */
function assetLoader(): Plugin {
  return {
    name: 'data-module-loader',
    enforce: 'pre',
    load(id: string) {
      const file = id.split('?')[0];
      if (!file.endsWith('.png')) return null;
      const b64 = readFileSync(file).toString('base64');
      return `export default Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0)).buffer;`;
    },
  };
}

export default defineConfig({ plugins: [assetLoader()] });
