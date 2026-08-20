import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPublicSupabaseConfig, runHeartbeat } from '../tools/supabase-heartbeat.mjs';

test('scheduled heartbeat loads only the browser-safe Supabase configuration', async () => {
  const config = await loadPublicSupabaseConfig();
  assert.match(config.url, /^https:\/\/[a-z0-9-]+\.supabase\.co$/);
  assert.ok(config.anonKey);
  assert.equal('serviceRoleKey' in config, false);
});

test('scheduled heartbeat sends a body-free HEAD request with the publishable key', async () => {
  const calls = [];
  const status = await runHeartbeat(
    { url: 'https://example.supabase.co', anonKey: 'public-test-key' },
    async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    }
  );
  assert.equal(status, 200);
  assert.deepEqual(calls, [{
    url: 'https://example.supabase.co/rest/v1/profiles?select=id&limit=1',
    options: { method: 'HEAD', headers: { apikey: 'public-test-key' } }
  }]);
});
