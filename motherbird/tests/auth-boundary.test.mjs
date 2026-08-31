import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('phone and Watch expose passkeys without Google sign-in', async () => {
  const [phone, watch] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../watch.html', import.meta.url), 'utf8')
  ]);
  assert.match(phone, /id="passkeySignInButton"/);
  assert.match(watch, /id="watchPasskeySignIn"/);
  assert.doesNotMatch(`${phone}\n${watch}`, /googleSignInButton|Continue with Google|Google password/i);
});

test('Watch authentication uses passkeys without app-data writes', async () => {
  const source = await readFile(new URL('../js/watch-app.js', import.meta.url), 'utf8');
  assert.match(source, /signInWithPasskey/);
  assert.match(source, /auth\.getSession/);
  assert.doesNotMatch(source, /\.from\s*\(|\.rpc\s*\(|\.upsert\s*\(|\.insert\s*\(|\.update\s*\(/);
});

test('service worker versions the updated shell and caches app modules together', async () => {
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /walk-wildlife-shell-v66/);
  assert.match(worker, /walk-wildlife-companion-media-v2/);
  for (const moduleName of ['discovery-taxonomy', 'field-guide', 'online', 'cloud-journal', 'journal-pane', 'layer-system', 'personal-places', 'companion']) {
    assert.match(worker, new RegExp(`\\.\\/js\\/${moduleName}\\.js`));
  }
  assert.doesNotMatch(worker, /watch-companion\.js/);
});
