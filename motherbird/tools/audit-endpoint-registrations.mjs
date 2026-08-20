import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectKpiInventory } from './build-kpi-index.mjs';
import { loadPublicSupabaseConfig, runHeartbeat } from './supabase-heartbeat.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

async function probeSupabase() {
  try {
    const config = await loadPublicSupabaseConfig();
    const status = await runHeartbeat(config);
    const schemaResponse = await fetch(`${config.url}/rest/v1/`, {
      headers: { apikey: config.anonKey, Accept: 'application/openapi+json' }
    });
    const schema = schemaResponse.ok ? await schemaResponse.json() : {};
    const exposedRelations = Object.keys(schema.paths || {}).map((path) => path.replace(/^\//, '')).filter(Boolean).sort();
    return {
      status: 'verified',
      httpStatus: status,
      detail: 'RLS-protected profile read succeeded; no rows or credential values recorded.',
      publicSchema: {
        status: schemaResponse.ok ? 'verified' : 'unavailable',
        httpStatus: schemaResponse.status,
        exposedRelationCount: exposedRelations.length,
        exposedRelations
      }
    };
  } catch (error) {
    return { status: 'failed', detail: String(error?.message || error).replace(/sb_[A-Za-z0-9_-]+/g, '[redacted]') };
  }
}

async function probeNyc(endpoint) {
  if (!endpoint.credentialEnv || !process.env[endpoint.credentialEnv]) {
    return { status: 'blocked', detail: `${endpoint.credentialEnv || 'credential'} is not available in this runner.` };
  }
  return { status: 'deferred', detail: 'Credential is present, but acquisition should run through the governed regional adapter so its raw response and validation report remain auditable.' };
}

export async function auditEndpointRegistrations({ live = false, output = resolve(root, 'dist', 'kpi', 'endpoint-audit.json'), record = false } = {}) {
  const model = await collectKpiInventory();
  const checkedAt = new Date().toISOString();
  const registrations = [];
  for (const endpoint of model.endpointRegistry.registrations) {
    let liveProbe = { status: 'not-requested', detail: 'Run with --live to perform safe account health checks.' };
    if (live && endpoint.id === 'supabase-project') liveProbe = await probeSupabase();
    else if (live && endpoint.provider === 'NYC API Developers Portal') liveProbe = await probeNyc(endpoint);
    const nextAction = liveProbe.status === 'blocked' && endpoint.credentialEnv
      ? `Provision ${endpoint.credentialEnv} in the runner, then rerun this audit.`
      : liveProbe.status === 'verified' && endpoint.productionStatus !== 'verified'
        ? endpoint.id === 'supabase-project'
          ? 'Reconcile the public schema with the proposed migration, then verify a real import manifest before marking production.'
          : 'Execute the governed import and record its manifest, row count, and freshness.'
        : endpoint.nextAction;
    registrations.push({
      id: endpoint.id,
      service: endpoint.service,
      registered: true,
      configured: endpoint.configured,
      credentialStatus: endpoint.credentialStatus,
      health: liveProbe,
      productionStatus: endpoint.productionStatus,
      nextAction
    });
  }
  const report = {
    schemaVersion: 1,
    checkedAt,
    scope: 'Account registration, repository configuration, redacted health, and production evidence are independent gates.',
    registrations,
    summary: {
      registered: registrations.length,
      configured: registrations.filter((item) => item.configured).length,
      healthVerified: registrations.filter((item) => item.health.status === 'verified').length,
      producing: registrations.filter((item) => item.productionStatus === 'verified').length
    }
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  if (record && live) {
    const evidenceOutput = resolve(root, 'data', 'endpoint-health.json');
    await mkdir(dirname(evidenceOutput), { recursive: true });
    await writeFile(evidenceOutput, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditEndpointRegistrations({ live: process.argv.includes('--live'), record: process.argv.includes('--record') });
  console.log(JSON.stringify(report.summary));
}
