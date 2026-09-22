/**
 * Wrangler bundles files matched by the `Data` rule in wrangler.toml as
 * ArrayBuffer modules; vitest loads the same import through the `assetLoader`
 * plugin in vitest.config.ts.
 */
declare module '*.png' {
  const bytes: ArrayBuffer;
  export default bytes;
}
