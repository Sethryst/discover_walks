import { state } from './state.js';
import { CITIES } from './constants.js';
import { el } from './utils.js';
import { toast } from './ui.js';
import { getWalkingCellRegistry } from './walking-cell-runtime.js?v=20261006-routing-hardening-4';
import {
  exportValhallaPackage,
  importValhallaPackage,
  installValhallaPackage,
  listInstalledValhallaPackages,
  removeValhallaPackage,
  resolveInstalledValhallaManifest
} from './valhalla-package-store.js?v=20261104-valhalla-portable-1';

let candidate = null;
let busy = false;

export function initRegionalRoutingPackagesUI() {
  if (!el('regionalRoutingPackagePanel') || initRegionalRoutingPackagesUI.bound) return;
  initRegionalRoutingPackagesUI.bound = true;
  el('downloadRegionalRoutingButton')?.addEventListener('click', () => void downloadCurrentArea());
  el('exportRegionalRoutingButton')?.addEventListener('click', () => void exportCurrentPackage());
  el('removeRegionalRoutingButton')?.addEventListener('click', () => void removeCurrentPackage());
  el('importRegionalRoutingInput')?.addEventListener('change', (event) => void importPackageFile(event));
  window.addEventListener('walking-cell-ready', () => void refreshRegionalRoutingPackagesUI());
  window.addEventListener('city-changed', () => void refreshRegionalRoutingPackagesUI());
  void refreshRegionalRoutingPackagesUI();
}

export async function refreshRegionalRoutingPackagesUI() {
  const status = el('regionalRoutingPackageStatus');
  if (!status || busy) return;
  const installed = await listInstalledValhallaPackages().catch(() => []);
  candidate = await currentValhallaCandidate().catch(() => null);
  const current = candidate
    ? await resolveInstalledValhallaManifest(candidate.artifacts.valhalla_manifest.url).catch(() => null)
    : null;
  const selected = current || installed[0] || null;

  if (current) {
    status.textContent = `${candidate.name || candidate.id} routing is downloaded · ${formatBytes(current.bytes)} · ${current.tileCount} graph tiles.`;
  } else if (candidate) {
    status.textContent = `${candidate.name || candidate.id} can be downloaded for completely offline driving, walking, and cycling routes.`;
  } else if (selected) {
    status.textContent = `${selected.release} is stored on this device. No published Valhalla package matches the selected map area.`;
  } else {
    status.textContent = 'No Valhalla routing package is published for the selected map area yet. You can still import a compatible package file.';
  }
  setButton('downloadRegionalRoutingButton', busy || !candidate || Boolean(current));
  setButton('exportRegionalRoutingButton', busy || !selected);
  setButton('removeRegionalRoutingButton', busy || !selected);
  el('downloadRegionalRoutingButton')?.classList.toggle('hidden', !candidate || Boolean(current));
  el('regionalRoutingPackageName')?.replaceChildren(document.createTextNode(selected?.release || candidate?.name || candidate?.id || 'Selected area'));
}

async function currentValhallaCandidate() {
  const registry = await getWalkingCellRegistry();
  const center = state.walkingCell?.bounds
    ? { lat: (state.walkingCell.bounds.south + state.walkingCell.bounds.north) / 2, lng: (state.walkingCell.bounds.west + state.walkingCell.bounds.east) / 2 }
    : CITIES[state.activeCity]?.center;
  const matches = center ? registry.findAll(center.lat, center.lng) : registry.cells;
  return matches.find((cell) => cell.routingEngine === 'valhalla-wasm' && cell.artifacts?.valhalla_manifest) || null;
}

async function downloadCurrentArea() {
  if (!candidate || busy) return;
  await withBusy('Downloading and verifying every routing tile…', async () => {
    await globalThis.navigator?.storage?.persist?.().catch(() => false);
    const installed = await installValhallaPackage(candidate.artifacts.valhalla_manifest.url);
    toast(`${candidate.name || candidate.id} routing is ready offline.`);
    window.dispatchEvent(new CustomEvent('regional-routing-package-changed', { detail: installed }));
  });
}

async function exportCurrentPackage() {
  if (busy) return;
  const selected = await selectedInstalledPackage();
  if (!selected) return;
  await withBusy('Preparing the routing package export…', async () => {
    const blob = await exportValhallaPackage(selected.sourceManifestUrl);
    downloadBlob(blob, `${safeName(selected.release)}.walkvalhalla`);
    toast('Offline routing package exported.');
  });
}

async function removeCurrentPackage() {
  if (busy) return;
  const selected = await selectedInstalledPackage();
  if (!selected || !confirm(`Remove offline routing package “${selected.release}” from this device? Your journal and activity will not be changed.`)) return;
  await withBusy('Removing the routing package…', async () => {
    await removeValhallaPackage(selected.sourceManifestUrl);
    toast('Offline routing package removed.');
    window.dispatchEvent(new CustomEvent('regional-routing-package-changed', { detail: { removed: selected.release } }));
  });
}

async function importPackageFile(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file || busy) return;
  await withBusy('Verifying and importing the routing package…', async () => {
    const installed = await importValhallaPackage(file);
    toast(`${installed.release} is ready for offline routing.`);
    window.dispatchEvent(new CustomEvent('regional-routing-package-changed', { detail: installed }));
  });
}

async function selectedInstalledPackage() {
  if (candidate) {
    const current = await resolveInstalledValhallaManifest(candidate.artifacts.valhalla_manifest.url).catch(() => null);
    if (current) return current;
  }
  return (await listInstalledValhallaPackages().catch(() => []))[0] || null;
}

async function withBusy(message, operation) {
  busy = true;
  const status = el('regionalRoutingPackageStatus');
  if (status) status.textContent = message;
  for (const id of ['downloadRegionalRoutingButton', 'exportRegionalRoutingButton', 'removeRegionalRoutingButton']) setButton(id, true);
  try { await operation(); }
  catch (error) { toast(error?.message || 'The routing package could not be changed.'); }
  finally { busy = false; await refreshRegionalRoutingPackagesUI(); }
}

function setButton(id, disabled) { const button = el(id); if (button) button.disabled = disabled; }
function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return 'verified';
  const value = Number(bytes);
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
}
function safeName(value) { return String(value || 'routing-package').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
