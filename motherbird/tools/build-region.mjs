// Compatibility entry point. Region builds now always create a validated
// offline package; the former in-memory placeholder path has been removed.
console.warn('build-region.mjs is deprecated; forwarding to the real region package build.');
await import('./region-build.mjs');
