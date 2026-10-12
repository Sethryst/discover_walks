import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('radio exposes the complete SoundCloud catalog and transport surfaces', async () => {
  const [radio, html, serviceWorker, map, customization] = await Promise.all([
    readFile(new URL('js/radio.js', root), 'utf8'),
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('service-worker.js', root), 'utf8'),
    readFile(new URL('js/map.js', root), 'utf8'),
    readFile(new URL('map-customization.css', root), 'utf8')
  ]);
  const urls = [...radio.matchAll(/https:\/\/soundcloud\.com\/wellness-walks\/sets\/([^']+)/g)].map((match) => match[1]);
  assert.equal(new Set(urls).size, 60);
  assert.match(radio, /Classic Gospel Hymns · Oh the Deep, Deep Love of Jesus/);
  assert.match(radio, /getSounds/);
  assert.match(radio, /soundcloudWidget\?\.pause/);
  assert.match(radio, /radioLocalUploadInput/);
  assert.match(radio, /sourceType: 'local-upload'/);
  assert.match(radio, /radio_saved_tracks/);
  for (const id of ['radioPreviousButton', 'radioPlayButton', 'radioNextButton', 'radioShuffleButton', 'radioRepeatButton', 'radioQueueButton', 'radioFavoriteButton', 'radioMiniPreviousButton', 'radioMiniPlayButton', 'radioMiniNextButton']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="radioLiveSources"/);
  assert.match(html, /id="radioLocalSources"/);
  assert.match(html, /id="mapMarkerOutline"/);
  assert.match(map, /place-cluster-glyph--\$\{light\}/);
  assert.doesNotMatch(map, /cluster\.getChildCount\(\)<\/span>/);
  assert.match(map, /state\.map\.on\('moveend', refreshSettledViewport\)/);
  assert.match(customization, /map-outline-dark/);
  assert.match(serviceWorker, /const APP_CACHE = 'walk-wildlife-shell-v445';/);
});
