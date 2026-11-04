import { el } from './utils.js';

function showUpdate(registration) {
  const panel = el('appUpdate');
  if (!panel || !registration.waiting) return;
  panel.classList.remove('hidden');
  el('applyAppUpdate')?.addEventListener('click', async () => {
    el('applyAppUpdate').disabled = true;
    el('applyAppUpdate').textContent = 'Saving…';
    const saved = new Promise((resolve) => window.addEventListener('journal-save-complete', resolve, { once: true }));
    window.dispatchEvent(new CustomEvent('journal-close-requested', { detail: { note: el('journalNote')?.value || '', walkId: el('journalForm')?.dataset.walkId || '' } }));
    await Promise.race([saved, new Promise((resolve) => setTimeout(resolve, 2000))]);
    el('applyAppUpdate').textContent = 'Updating…';
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
  }, { once: true });
  el('dismissAppUpdate')?.addEventListener('click', () => panel.classList.add('hidden'), { once: true });
}

export async function initPwaUpdates() {
  if (!('serviceWorker' in navigator)) return null;
  const isLocalDemo = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // The localhost demo is a live source tree, not an installed PWA. A
  // service-worker update/controllerchange cycle can otherwise reload the
  // page repeatedly while the local server is serving changing source files.
  if (isLocalDemo) return null;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  const registration = await navigator.serviceWorker.register('./service-worker.js?v=20261103-656', { updateViaCache: 'none' });
  const activateLocalUpdate = () => { if (isLocalDemo && registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' }); };
  if (registration.waiting) { if (isLocalDemo) activateLocalUpdate(); else showUpdate(registration); }
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) { if (isLocalDemo) activateLocalUpdate(); else showUpdate(registration); }
    });
  });
  // Check on every foreground launch; the browser can otherwise wait many
  // hours before noticing a new Pages deployment.
  await registration.update().catch(() => {});
  return registration;
}
