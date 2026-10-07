/* Discover Walks Journal — local-first walking, history, and nature journal. */

import('./js/loader.js?v=20261007-regional-worker-path-2').then(({ init }) => init()).catch((error) => {
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
