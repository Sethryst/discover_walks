import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public legal pages disclose Google auth, local data, account deletion, and safety limits', async () => {
  const [privacy, terms, home] = await Promise.all([
    readFile(new URL('../privacy.html', import.meta.url), 'utf8'),
    readFile(new URL('../terms.html', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8')
  ]);
  assert.match(privacy, /Google sign-in/);
  assert.match(privacy, /does not request access to Gmail/);
  assert.match(privacy, /account-deletion requests/);
  assert.match(privacy, /walk routes, journal entries, observations, photos/i);
  assert.match(terms, /not emergency, medical, legal, election/);
  assert.match(terms, /source information/i);
  assert.match(home, /href="\.\/privacy\.html"/);
  assert.match(home, /href="\.\/terms\.html"/);
});
