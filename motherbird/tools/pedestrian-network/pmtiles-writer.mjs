import fs from 'node:fs/promises';

const HEADER_BYTES = 127;
const EXTENT = 4096;

export async function writeWalkNetworkPmtiles(filePath, graph, barriers, {
  bounds,
  sourceVersion,
  producerVersion,
  name = 'Mother Bird walk network',
  attribution = 'OpenStreetMap contributors',
  zoom = 14
} = {}) {
  if (!Array.isArray(graph?.edges) || !graph.edges.length) throw new Error('Cannot create walk-network.pmtiles without routing edges.');
  if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) throw new Error('Cannot create walk-network.pmtiles without finite bounds.');
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 18) throw new Error('PMTiles zoom must be an integer from 0 through 18.');

  const tiles = buildTiles(graph.edges, barriers || [], zoom);
  if (!tiles.size) throw new Error('Walk network produced no vector tiles.');
  const entries = [...tiles.entries()]
    .map(([key, layers]) => {
      const [x, y] = key.split('/').map(Number);
      return { tileId: zxyToTileId(zoom, x, y), bytes: encodeTile(layers) };
    })
    .sort((left, right) => left.tileId - right.tileId);
  const directory = serializeDirectory(entries);
  if (directory.length > 16_000) throw new Error(`PMTiles root directory is ${directory.length} bytes; lower pedestrianNetwork.tileZoom or use an external PMTiles tiler.`);
  const metadataObject = {
    name,
    description: 'Walking display geometry derived from the same normalized source as the Mother Bird routing runtime.',
    attribution,
    version: sourceVersion,
    source_version: sourceVersion,
    producer_version: producerVersion,
    vector_layers: [
      { id: 'walk_network', fields: { edge_id: 'String', edge_type: 'String', access: 'String', source_dataset_id: 'String', source_feature_id: 'String', confidence: 'String', osm_id: 'String', access_evidence: 'String' }, minzoom: zoom, maxzoom: zoom },
      { id: 'barriers', fields: { source_feature_id: 'String', barrier: 'String', highway: 'String', osm_id: 'String' }, minzoom: zoom, maxzoom: zoom }
    ]
  };
  const metadata = Buffer.from(stableStringify(metadataObject));
  const tileBytes = Buffer.concat(entries.map(({ bytes }) => bytes));
  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + directory.length;
  const tileOffset = metadataOffset + metadata.length;
  const archive = Buffer.alloc(tileOffset + tileBytes.length);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  archive.write('PMTiles', 0, 'ascii');
  archive[7] = 3;
  for (const [offset, value] of [
    [8, rootOffset], [16, directory.length], [24, metadataOffset], [32, metadata.length],
    [40, tileOffset], [48, 0], [56, tileOffset], [64, tileBytes.length],
    [72, entries.length], [80, entries.length], [88, entries.length]
  ]) view.setBigUint64(offset, BigInt(value), true);
  archive[96] = 1; // clustered
  archive[97] = 1; // internal compression: none
  archive[98] = 1; // tile compression: none
  archive[99] = 1; // MVT
  archive[100] = zoom;
  archive[101] = zoom;
  bounds.forEach((value, index) => view.setInt32(102 + index * 4, Math.round(value * 1e7), true));
  archive[118] = zoom;
  view.setInt32(119, Math.round(((bounds[0] + bounds[2]) / 2) * 1e7), true);
  view.setInt32(123, Math.round(((bounds[1] + bounds[3]) / 2) * 1e7), true);
  directory.copy(archive, rootOffset);
  metadata.copy(archive, metadataOffset);
  tileBytes.copy(archive, tileOffset);
  await atomicWrite(filePath, archive);
  return { bytes: archive.length, tile_count: entries.length, metadata: metadataObject, zoom };
}

export function readPmtilesHeader(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length < HEADER_BYTES || buffer.subarray(0, 7).toString('ascii') !== 'PMTiles' || buffer[7] !== 3) throw new Error('Expected a PMTiles v3 archive.');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const uint64 = (offset) => Number(view.getBigUint64(offset, true));
  return {
    spec_version: buffer[7],
    root_directory_offset: uint64(8), root_directory_length: uint64(16),
    metadata_offset: uint64(24), metadata_length: uint64(32),
    tile_data_offset: uint64(56), tile_data_length: uint64(64),
    addressed_tiles: uint64(72), tile_entries: uint64(80), tile_contents: uint64(88),
    internal_compression: buffer[97], tile_compression: buffer[98], tile_type: buffer[99],
    min_zoom: buffer[100], max_zoom: buffer[101],
    bounds: [view.getInt32(102, true), view.getInt32(106, true), view.getInt32(110, true), view.getInt32(114, true)].map((value) => value / 1e7)
  };
}

export function readPmtilesMetadata(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const header = readPmtilesHeader(buffer);
  return JSON.parse(buffer.subarray(header.metadata_offset, header.metadata_offset + header.metadata_length).toString('utf8'));
}

function buildTiles(edges, barriers, zoom) {
  const tiles = new Map();
  for (const edge of [...edges].sort((left, right) => left.edge_id.localeCompare(right.edge_id))) {
    const properties = {
      edge_id: edge.edge_id,
      edge_type: edge.edge_type,
      access: edge.raw_access,
      source_dataset_id: edge.source_dataset_id,
      source_feature_id: edge.source_feature_id,
      confidence: edge.confidence,
      policy_confidence: edge.policy_confidence,
      access_evidence: edge.access_evidence,
      osm_id: edge.source_attributes?.osm_id,
      access_conflict: edge.source_attributes?._mb_access_conflict || false,
      crossing: edge.edge_type === 'crossing'
    };
    addLineFeature(tiles, 'walk_network', edge.geometry.coordinates, properties, zoom);
  }
  for (const barrier of [...barriers].sort((left, right) => String(left.properties?._mb_source_feature_id).localeCompare(String(right.properties?._mb_source_feature_id)))) {
    const properties = pickDefined({
      source_feature_id: barrier.properties?._mb_source_feature_id,
      source_dataset_id: barrier.properties?._mb_source_dataset_id,
      barrier: barrier.properties?.barrier,
      highway: barrier.properties?.highway,
      access: barrier.properties?.access,
      foot: barrier.properties?.foot,
      osm_id: barrier.properties?.osm_id
    });
    if (barrier.geometry?.type === 'Point') addPointFeature(tiles, 'barriers', barrier.geometry.coordinates, properties, zoom);
    else for (const line of lineParts(barrier.geometry)) addLineFeature(tiles, 'barriers', line, properties, zoom);
  }
  return tiles;
}

function addLineFeature(tiles, layerName, coordinates, properties, zoom) {
  const projected = coordinates.map((position) => project(position, zoom));
  const pieces = new Map();
  for (let index = 0; index < projected.length - 1; index += 1) {
    const start = projected[index]; const end = projected[index + 1];
    const minX = Math.floor(Math.min(start[0], end[0])); const maxX = Math.floor(Math.max(start[0], end[0]));
    const minY = Math.floor(Math.min(start[1], end[1])); const maxY = Math.floor(Math.max(start[1], end[1]));
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      const clipped = clipSegmentToBox(start, end, x, y, x + 1, y + 1);
      if (!clipped) continue;
      const key = `${x}/${y}`;
      const part = clipped.map(([worldX, worldY]) => [Math.round((worldX - x) * EXTENT), Math.round((worldY - y) * EXTENT)]);
      if (part[0][0] === part[1][0] && part[0][1] === part[1][1]) continue;
      (pieces.get(key) || pieces.set(key, []).get(key)).push(part);
    }
  }
  for (const [key, geometry] of pieces) addTileFeature(tiles, key, layerName, { type: 2, geometry, properties });
}

function addPointFeature(tiles, layerName, coordinate, properties, zoom) {
  const [worldX, worldY] = project(coordinate, zoom);
  const x = Math.floor(worldX); const y = Math.floor(worldY);
  addTileFeature(tiles, `${x}/${y}`, layerName, { type: 1, geometry: [[[Math.round((worldX - x) * EXTENT), Math.round((worldY - y) * EXTENT)]]], properties });
}

function addTileFeature(tiles, key, layerName, feature) {
  const layers = tiles.get(key) || new Map();
  const features = layers.get(layerName) || [];
  features.push(feature);
  layers.set(layerName, features);
  tiles.set(key, layers);
}

function encodeTile(layers) {
  const chunks = [];
  for (const [name, features] of [...layers.entries()].sort(([left], [right]) => left.localeCompare(right))) chunks.push(field(3, encodeLayer(name, features)));
  return Buffer.concat(chunks);
}

function encodeLayer(name, features) {
  const keys = [];
  const keyIndex = new Map();
  const values = [];
  const valueIndex = new Map();
  const encodedFeatures = features.map((feature, index) => {
    const tags = [];
    for (const [key, value] of Object.entries(pickDefined(feature.properties)).sort(([left], [right]) => left.localeCompare(right))) {
      if (!keyIndex.has(key)) { keyIndex.set(key, keys.length); keys.push(key); }
      const token = `${typeof value}:${stableStringify(value)}`;
      if (!valueIndex.has(token)) { valueIndex.set(token, values.length); values.push(value); }
      tags.push(keyIndex.get(key), valueIndex.get(token));
    }
    return Buffer.concat([
      unsignedField(1, index + 1),
      field(2, Buffer.from(tags.flatMap(varint))),
      unsignedField(3, feature.type),
      field(4, Buffer.from(encodeGeometry(feature.geometry, feature.type)))
    ]);
  });
  return Buffer.concat([
    field(1, Buffer.from(name)),
    ...encodedFeatures.map((feature) => field(2, feature)),
    ...keys.map((key) => field(3, Buffer.from(key))),
    ...values.map((value) => field(4, encodeValue(value))),
    unsignedField(5, EXTENT),
    unsignedField(15, 2)
  ]);
}

function encodeValue(value) {
  if (typeof value === 'boolean') return Buffer.from([...varint(7 * 8), value ? 1 : 0]);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const buffer = Buffer.alloc(9); buffer[0] = 3 * 8 + 1; buffer.writeDoubleLE(value, 1); return buffer;
  }
  const rendered = typeof value === 'string' ? value : stableStringify(value);
  return field(1, Buffer.from(rendered));
}

function encodeGeometry(parts, type) {
  const output = [];
  let cursorX = 0; let cursorY = 0;
  for (const part of parts) {
    if (!part.length) continue;
    output.push(...varint(9));
    output.push(...varint(zigzag(part[0][0] - cursorX)), ...varint(zigzag(part[0][1] - cursorY)));
    cursorX = part[0][0]; cursorY = part[0][1];
    if (type === 2 && part.length > 1) {
      output.push(...varint((part.length - 1) * 8 + 2));
      for (const point of part.slice(1)) {
        output.push(...varint(zigzag(point[0] - cursorX)), ...varint(zigzag(point[1] - cursorY)));
        cursorX = point[0]; cursorY = point[1];
      }
    }
  }
  return output;
}

function serializeDirectory(entries) {
  const output = [...varint(entries.length)];
  let previousId = 0;
  for (const entry of entries) { output.push(...varint(entry.tileId - previousId)); previousId = entry.tileId; }
  for (const _entry of entries) output.push(1);
  for (const entry of entries) output.push(...varint(entry.bytes.length));
  entries.forEach((_entry, index) => output.push(...varint(index === 0 ? 1 : 0)));
  return Buffer.from(output);
}

function zxyToTileId(z, x, y) {
  let tileId = ((2 ** z) ** 2 - 1) / 3;
  let level = z - 1;
  let a = x; let b = y;
  for (let bit = 2 ** level; bit > 0; bit >>= 1) {
    const rx = a & bit; const ry = b & bit;
    tileId += (3 * rx ^ ry) * 2 ** level;
    [a, b] = rotate(bit, a, b, rx, ry);
    level -= 1;
  }
  return tileId;
}

function rotate(size, x, y, rx, ry) {
  if (ry === 0) return rx !== 0 ? [size - 1 - y, size - 1 - x] : [y, x];
  return [x, y];
}

function project([lon, lat], zoom) {
  const n = 2 ** zoom;
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return [(lon + 180) / 360 * n, (1 - Math.asinh(Math.tan(safeLat * Math.PI / 180)) / Math.PI) / 2 * n];
}

function clipSegmentToBox(start, end, minX, minY, maxX, maxY) {
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  let low = 0; let high = 1;
  for (const [p, q] of [[-dx, start[0] - minX], [dx, maxX - start[0]], [-dy, start[1] - minY], [dy, maxY - start[1]]]) {
    if (p === 0 && q < 0) return null;
    if (p === 0) continue;
    const r = q / p;
    if (p < 0) low = Math.max(low, r); else high = Math.min(high, r);
    if (low > high) return null;
  }
  return [[start[0] + low * dx, start[1] + low * dy], [start[0] + high * dx, start[1] + high * dy]];
}

function lineParts(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function field(number, bytes) {
  return Buffer.concat([Buffer.from(varint(number * 8 + 2)), Buffer.from(varint(bytes.length)), Buffer.from(bytes)]);
}

function unsignedField(number, value) {
  return Buffer.from([...varint(number * 8), ...varint(value)]);
}

function varint(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Cannot encode PMTiles varint value: ${value}`);
  const result = [];
  let remaining = value;
  while (remaining > 127) { result.push((remaining % 128) | 128); remaining = Math.floor(remaining / 128); }
  result.push(remaining);
  return result;
}

function zigzag(value) {
  return value < 0 ? -value * 2 - 1 : value * 2;
}

function pickDefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

function stableStringify(value) {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function atomicWrite(filePath, contents) {
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, contents);
  await fs.rename(temporary, filePath);
}
