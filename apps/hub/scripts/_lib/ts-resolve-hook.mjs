// Minimal ESM resolver hook that appends `.ts` when a bare relative
// specifier doesn't resolve. Used by the CN-05 regression harnesses
// so they can `--experimental-strip-types` the production TS modules
// without rewriting the import graph.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    if (
      (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'ERR_UNSUPPORTED_DIR_IMPORT') &&
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.(ts|js|mjs|cjs|json)$/.test(specifier)
    ) {
      return await nextResolve(specifier + '.ts', context);
    }
    throw e;
  }
}
