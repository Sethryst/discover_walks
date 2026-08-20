import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

export async function loadPublicSupabaseConfig(path = new URL('../supabase-config.js', import.meta.url)) {
  const source = await readFile(path, 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: 'supabase-config.js' });
  const config = context.window.WALK_WILDLIFE_SUPABASE || {};
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url || '') || !config.anonKey) {
    throw new Error('supabase-config.js does not contain a valid public project URL and publishable key.');
  }
  return config;
}

export async function runHeartbeat(config, request = fetch) {
  const response = await request(`${config.url.replace(/\/$/, '')}/rest/v1/profiles?select=id&limit=1`, {
    method: 'HEAD',
    headers: { apikey: config.anonKey }
  });
  if (!response.ok) throw new Error(`Supabase heartbeat failed with HTTP ${response.status}.`);
  return response.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const status = await runHeartbeat(await loadPublicSupabaseConfig());
  console.log(`Supabase heartbeat succeeded (HTTP ${status}).`);
}
