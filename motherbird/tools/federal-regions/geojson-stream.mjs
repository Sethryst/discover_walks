import { createReadStream } from 'node:fs';

/** Streams FeatureCollection members without retaining a national geometry document. */
export async function* streamGeoJsonFeatures(filename) {
  const input = createReadStream(filename, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  let prefix = '';
  let foundFeatures = false;
  let feature = '';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for await (const chunk of input) {
    let text = chunk;
    if (!foundFeatures) {
      prefix += chunk;
      const match = /"features"\s*:\s*\[/.exec(prefix);
      if (!match) {
        prefix = prefix.slice(-96);
        continue;
      }
      text = prefix.slice(match.index + match[0].length);
      prefix = '';
      foundFeatures = true;
    }

    for (const character of text) {
      if (!feature) {
        if (character === '{') {
          feature = character;
          depth = 1;
          inString = false;
          escaped = false;
        }
        continue;
      }

      feature += character;
      if (escaped) { escaped = false; continue; }
      if (inString && character === '\\') { escaped = true; continue; }
      if (character === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (character === '{') depth += 1;
      if (character === '}') depth -= 1;
      if (depth === 0) {
        yield JSON.parse(feature);
        feature = '';
      }
    }
  }

  if (!foundFeatures) throw new Error(`${filename}: GeoJSON FeatureCollection has no features array.`);
  if (feature || depth) throw new Error(`${filename}: truncated GeoJSON feature.`);
}
