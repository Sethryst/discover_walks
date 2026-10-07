import db from './storage.js';

const labels = { checking: 'Device journal is loading', durable: 'Changes are safely saved on this device', temporary: 'This session is temporary until device storage recovers', recovering: 'Another tab is finishing a database update', failed: 'Device journal storage needs attention', 'quota-exceeded': 'Device storage quota is full' };

export function initStorageDiagnostics() {
  if (!new URLSearchParams(location.search).has('diagnose')) return;
  const panel = document.createElement('aside');
  panel.id = 'storageDiagnostics'; panel.setAttribute('aria-live', 'polite');
  panel.innerHTML = '<h2>Storage diagnostics</h2><p id="storageDiagnosticsStatus"></p><pre id="storageDiagnosticsDetails"></pre>';
  document.body.append(panel);
  const render = () => { const report = db.diagnostics(); document.getElementById('storageDiagnosticsStatus').textContent = labels[report.state] || report.state; document.getElementById('storageDiagnosticsDetails').textContent = JSON.stringify({ database: report.databaseName, currentVersion: report.currentVersion, targetVersion: report.targetVersion, pendingMigrations: db.migrationPlan(report.currentVersion), memoryRecords: report.memoryRecords, recentFailures: report.transitions.filter((item) => item.error || ['failed', 'quota-exceeded'].includes(item.state)).slice(-10), lastTransition: report.transitions.at(-1) }, null, 2); };
  db.onPersistenceState(render); render();
}
