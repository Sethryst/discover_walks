import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { oauthReturnUrl, signInWithGoogle } from '../js/online.js';
import { state } from '../js/state.js';

test('Google OAuth returns to the Pages app root without retaining callback parameters', () => {
  assert.equal(oauthReturnUrl('https://sethryst.github.io/gremlin_labs/?code=secret#token'), 'https://sethryst.github.io/gremlin_labs/');
  assert.equal(oauthReturnUrl('http://127.0.0.1:4173/index.html?code=secret'), 'http://127.0.0.1:4173/');
});

test('Google OAuth uses Supabase and sends no password or client secret', async () => {
  let request;
  state.online.client = { auth: { signInWithOAuth: async (value) => { request = value; return { error: null }; } } };
  const previousLocation = globalThis.location;
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://sethryst.github.io/gremlin_labs/' } });
  try { assert.equal(await signInWithGoogle(), true); } finally {
    state.online.client = null;
    if (previousLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, 'location', { configurable: true, value: previousLocation });
  }
  assert.deepEqual(request, { provider: 'google', options: { redirectTo: 'https://sethryst.github.io/gremlin_labs/' } });
  assert.doesNotMatch(JSON.stringify(request), /password|client_secret|service_role/i);
});

test('online UI explains the password boundary', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="googleSignInButton"/);
  assert.match(html, /never receives or stores your Google password/);
});

test('service worker versions the OAuth shell and caches every new module together', async () => {
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /walk-wildlife-shell-v43/);
  assert.match(worker, /\.\/js\/discovery-taxonomy\.js/);
  assert.match(worker, /\.\/js\/field-guide\.js/);
  assert.match(worker, /\.\/js\/online\.js/);
});
