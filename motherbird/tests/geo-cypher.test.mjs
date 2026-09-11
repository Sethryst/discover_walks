import test from 'node:test';
import assert from 'node:assert/strict';
if (!globalThis.btoa) globalThis.btoa = (value) => Buffer.from(value, 'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');

const { canonicalLineagePayload, publicKeyId, signGeoCypher, verifyGeoCypher, GEO_CYPHER_MAX_DURATION_MS } = await import('../js/geo-cypher.js');

async function fixturePin() {
  const audio = new Blob(['fairfax audio'], { type: 'audio/webm' });
  const digest = await crypto.subtle.digest('SHA-256', await audio.arrayBuffer());
  return {
    schemaVersion: 1, id: 'pin-1', createdAt: '2026-09-11T12:00:00.000Z',
    lat: 38.8462, lng: -77.3064, radiusMeters: 50, durationMs: 1200,
    mimeType: 'audio/webm', audio, contentHash: Buffer.from(digest).toString('base64'),
    creatorKeyId: 'fairfax-device', lineage: { rootId: 'pin-1', parentId: null, generation: 0 }
  };
}

test('Geo Cypher signs immutable location, media, and lineage metadata', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const pin = { ...await fixturePin(), creatorKeyId: await publicKeyId(publicKeyJwk) };
  const signed = await signGeoCypher(pin, { privateKey: pair.privateKey, publicKeyJwk, algorithm: 'ECDSA-P256-SHA256' });
  assert.equal(await verifyGeoCypher(signed), true);
  assert.match(canonicalLineagePayload(signed), /"rootId":"pin-1"/);
  assert.equal(await verifyGeoCypher({ ...signed, lat: signed.lat + 0.01 }), false);
  assert.equal(await verifyGeoCypher({ ...signed, lineage: { ...signed.lineage, parentId: 'forged' } }), false);
  assert.equal(await verifyGeoCypher({ ...signed, creatorKeyId: 'relabeled-device' }), false);
});

test('Geo Cypher rejects changed audio and caps recordings at two minutes', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const pin = { ...await fixturePin(), creatorKeyId: await publicKeyId(publicKeyJwk) };
  const signed = await signGeoCypher(pin, { privateKey: pair.privateKey, publicKeyJwk, algorithm: 'ECDSA-P256-SHA256' });
  assert.equal(await verifyGeoCypher({ ...signed, audio: new Blob(['replaced'], { type: 'audio/webm' }) }), false);
  assert.equal(GEO_CYPHER_MAX_DURATION_MS, 120000);
});

test('prototype UI exposes immediate signed responses without attribution-delay copy', async () => {
  const html = await (await import('node:fs/promises')).readFile(new URL('../index.html', import.meta.url), 'utf8');
  const source = await (await import('node:fs/promises')).readFile(new URL('../js/geo-cypher.js', import.meta.url), 'utf8');
  assert.match(html, /id="geoCypherButton"/);
  assert.match(html, /Pins carry signed lineage; responses begin recording immediately/);
  assert.doesNotMatch(source, /setTimeout\([^)]*,\s*5000\)|five.second delay/i);
});
