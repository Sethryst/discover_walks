import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('radio exposes the complete SoundCloud catalog and transport surfaces', async () => {
  const [radio, html, serviceWorker] = await Promise.all([
    readFile(new URL('js/radio.js', root), 'utf8'),
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('service-worker.js', root), 'utf8')
  ]);
  const urls = [...radio.matchAll(/https:\/\/soundcloud\.com\/wellness-walks\/sets\/([^']+)/g)].map((match) => match[1]);
  assert.equal(new Set(urls).size, 60);
  assert.match(radio, /Classic Gospel Hymns · Oh the Deep, Deep Love of Jesus/);
  assert.match(radio, /getSounds/);
  assert.match(radio, /soundcloudWidget\?\.pause/);
  for (const id of ['radioPreviousButton', 'radioPlayButton', 'radioNextButton', 'radioShuffleButton', 'radioRepeatButton', 'radioQueueButton', 'radioSaveButton', 'radioMiniPreviousButton', 'radioMiniPlayButton', 'radioMiniNextButton']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="radioLiveSources"/);
  assert.match(html, /id="radioLocalSources"/);
  assert.match(serviceWorker, /walk-wildlife-shell-v193/);
});
