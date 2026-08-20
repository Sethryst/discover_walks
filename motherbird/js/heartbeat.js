export const HEARTBEAT_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function heartbeatDue(lastHeartbeatAt, now = Date.now()) {
  const previous = Date.parse(lastHeartbeatAt || '');
  return !Number.isFinite(previous) || now - previous >= HEARTBEAT_INTERVAL_MS;
}

export async function readSupabaseHeartbeat(client, settings, persistSettings, now = new Date()) {
  if (!client || !heartbeatDue(settings.lastSupabaseHeartbeatAt, now.getTime())) {
    return { attempted: false, ok: false };
  }

  // HEAD executes a minimal database read without downloading profile rows.
  // Existing RLS remains the privacy boundary: anonymous visitors see no rows,
  // and signed-in visitors can see only records already allowed to them.
  const { error } = await client.from('profiles').select('id', { head: true }).limit(1);
  if (error) throw error;

  settings.lastSupabaseHeartbeatAt = now.toISOString();
  await persistSettings(settings);
  return { attempted: true, ok: true };
}
