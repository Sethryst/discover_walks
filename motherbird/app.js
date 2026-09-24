/* Discover Walks Journal — local-first walking, history, and nature journal. */

import('./js/loader.js').then(({ init }) => init()).catch((error) => {
  console.error('Walk & Wildlife startup failed:', error);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = new URLSearchParams(location.search).has('diagnose')
      ? `Startup failed: ${error?.message || error}`
      : 'The app could not start. Reload this page to try again.';
    toast.classList.remove('hidden');
  }
});
