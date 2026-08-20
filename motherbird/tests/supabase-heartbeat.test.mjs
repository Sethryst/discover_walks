import assert from 'node:assert/strict';
import test from 'node:test';
import { HEARTBEAT_INTERVAL_MS, heartbeatDue, readSupabaseHeartbeat } from '../js/heartbeat.js';

test('heartbeat is due for a new browser and throttled for twelve hours', () => {
  const now = Date.parse('2026-08-20T12:00:00Z');
  assert.equal(heartbeatDue(null, now), true);
  assert.equal(heartbeatDue('2026-08-20T01:00:01Z', now), false);
  assert.equal(heartbeatDue(new Date(now - HEARTBEAT_INTERVAL_MS).toISOString(), now), true);
});

test('heartbeat performs only a head read and saves no remote activity record', async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns, options) {
          calls.push(['select', columns, options]);
          return {
            async limit(value) {
              calls.push(['limit', value]);
              return { error: null };
            }
          };
        }
      };
    }
  };
  const settings = { lastSupabaseHeartbeatAt: null };
  let persisted = 0;
  const result = await readSupabaseHeartbeat(client, settings, async () => { persisted += 1; }, new Date('2026-08-20T12:00:00Z'));

  assert.deepEqual(result, { attempted: true, ok: true });
  assert.deepEqual(calls, [
    ['from', 'profiles'],
    ['select', 'id', { head: true }],
    ['limit', 1]
  ]);
  assert.equal(settings.lastSupabaseHeartbeatAt, '2026-08-20T12:00:00.000Z');
  assert.equal(persisted, 1);
});

test('failed heartbeat remains due so a later app start can retry', async () => {
  const client = {
    from() {
      return { select: () => ({ limit: async () => ({ error: new Error('offline') }) }) };
    }
  };
  const settings = { lastSupabaseHeartbeatAt: null };
  await assert.rejects(() => readSupabaseHeartbeat(client, settings, async () => {}), /offline/);
  assert.equal(settings.lastSupabaseHeartbeatAt, null);
});
