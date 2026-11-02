import db from './storage.js';

const formatBytes = (value) => {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 ** 3) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
};

async function collectHealth() {
  const [estimate, journal, observations, regions, regionPois, regionBuckets, drafts] = await Promise.all([
    Promise.resolve(navigator.storage?.estimate?.()).catch(() => ({})),
    db.all('walks').catch(() => []),
    db.all('observations').catch(() => []),
    db.all('regions').catch(() => []),
    db.all('region_pois').catch(() => []),
    db.all('region_buckets').catch(() => []),
    db.all('walk_drafts').catch(() => [])
  ]);
  let cacheEntries = 0;
  try {
    for (const name of await caches.keys()) cacheEntries += (await (await caches.open(name)).keys()).length;
  } catch { /* Cache Storage is optional. */ }
  const installedIds = new Set(regions.filter((region) => region.status === 'installed').map((region) => String(region.id)));
  const orphanedRegionRecords = [...regionPois, ...regionBuckets].filter((entry) => !installedIds.has(String(entry.regionId || entry.id))).length;
  const staleDrafts = drafts.filter((draft) => Date.now() - Date.parse(draft.updatedAt || 0) > 7 * 24 * 60 * 60 * 1000).length;
  return {
    used: formatBytes(estimate?.usage),
    quota: formatBytes(estimate?.quota),
    journal: journal.length,
    observations: observations.length,
    regions: regions.filter((region) => region.status === 'installed').length,
    orphanedRegionRecords,
    staleDrafts,
    cacheEntries,
    checkedAt: new Date().toLocaleString()
  };
}

export function initStorageHealth() {
  const sheet = document.getElementById('companionSheet');
  if (!sheet || document.getElementById('storageHealthSection')) return;
  const section = document.createElement('section');
  section.id = 'storageHealthSection';
  section.className = 'companion-settings-section storage-health-section';
  section.setAttribute('aria-labelledby', 'storageHealthTitle');
  section.innerHTML = '<div class="companion-section-heading"><div><span class="sheet-kicker">DEVICE CARE</span><h3 id="storageHealthTitle">Storage health</h3></div><button type="button" class="text-button" id="refreshStorageHealthButton">Check now</button></div><p id="storageHealthSummary">Your journal and offline areas stay on this device.</p><output id="storageHealthDetails" aria-live="polite"></output>';
  sheet.querySelector('.companion-settings-section')?.before(section);
  const output = section.querySelector('#storageHealthDetails');
  const refresh = async () => {
    output.textContent = 'Checking local storage…';
    const report = await collectHealth();
    const findings = [report.orphanedRegionRecords ? `${report.orphanedRegionRecords} orphaned regional record${report.orphanedRegionRecords === 1 ? '' : 's'}` : '', report.staleDrafts ? `${report.staleDrafts} old walk draft${report.staleDrafts === 1 ? '' : 's'} to review` : ''].filter(Boolean);
    output.textContent = `Device storage: ${report.used} used of ${report.quota} · ${report.regions} installed area${report.regions === 1 ? '' : 's'} · ${report.cacheEntries} cached assets · ${report.journal} saved walk${report.journal === 1 ? '' : 's'} · ${report.observations} observation${report.observations === 1 ? '' : 's'}${findings.length ? ` · Review: ${findings.join('; ')}` : ''} · checked ${report.checkedAt}`;
  };
  section.querySelector('#refreshStorageHealthButton').addEventListener('click', () => void refresh());
  refresh();
}
