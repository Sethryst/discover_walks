/* Discover Walks Journal — local-first walking, history, and nature journal. */
const startupStartedAt = performance.now();
let forcedReload = false;
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data?.type !== 'FORCE_RELOAD' || forcedReload) return;
  forcedReload = true;
  window.location.reload();
});
const startupTelemetry = (stage, details = {}) => {
  const event = { stage, elapsedMs: Math.round(performance.now() - startupStartedAt), ...details };
  globalThis.__MOTHERBIRD_STARTUP__ ||= { startedAt: new Date().toISOString(), stages: [] };
  globalThis.__MOTHERBIRD_STARTUP__.stages.push(event);
  console.info('[motherbird:startup]', event);
  return event;
};
startupTelemetry('document');
globalThis.__MOTHERBIRD_STARTUP_MARK__ = startupTelemetry;
startupTelemetry('app.js');

import('./js/loader.js?v=20261009-workspace-1').then(({ init }) => {
  startupTelemetry('loader imported');
  return init();
}).catch((error) => {
  startupTelemetry('startup failed', { failure: error?.message || String(error) });
  console.error('Walk & Wildlife startup failed:', error);
  document.getElementById('appSplashStatus')?.replaceChildren(document.createTextNode('The map needs another moment — try reload'));
  document.getElementById('appSplash')?.classList.add('app-splash--done');
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = new URLSearchParams(location.search).has('diagnose')
      ? `Startup failed: ${error?.message || error}`
      : 'The app could not start. Reload this page to try again.';
    toast.classList.remove('hidden');
  }
});
