// Synthetic, deterministic MVT/PMTiles v3 fixture. NOT geographic coverage.
// Format: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
const utf8 = (value) => [...new TextEncoder().encode(value)];
function varint(value) {
  const result = [];
  while (value > 127) { result.push((value % 128) | 128); value = Math.floor(value / 128); }
  return [...result, value];
}
const field = (number, bytes) => [...varint(number * 8 + 2), ...varint(bytes.length), ...bytes];
function geometry(points, polygon) {
  const zigzag = (n) => n < 0 ? -n * 2 - 1 : n * 2;
  let x = 0, y = 0;
  const out = [];
  points.forEach(([nextX, nextY], index) => {
    if (index === 0) out.push(9); // MoveTo, count 1
    if (index === 1) out.push((points.length - 1) * 8 + 2); // LineTo
    out.push(zigzag(nextX - x), zigzag(nextY - y)); x = nextX; y = nextY;
  });
  if (polygon) out.push(15); // ClosePath
  return out.flatMap(varint);
}
function layer(name, points, polygon = true) {
  const feature = [8, 1, 24, polygon ? 3 : 2, ...field(4, geometry(points, polygon))];
  return field(3, [...field(1, utf8(name)), ...field(2, feature), 40, ...varint(4096), 120, 2]);
}
export const PROOF_LOCATION = { lat: 38.9, lng: -77.3, zoom: 14 };
export function generateProofArchive(zxyToTileId) {
  const z = PROOF_LOCATION.zoom, n = 2 ** z;
  const x = Math.floor((PROOF_LOCATION.lng + 180) / 360 * n);
  const y = Math.floor((1 - Math.asinh(Math.tan(PROOF_LOCATION.lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const tile = new Uint8Array([
    ...layer('landuse', [[0,0],[4096,0],[4096,4096],[0,4096]]),
    ...layer('park', [[100,100],[1800,180],[1700,2900],[200,3000]]),
    ...layer('water', [[1900,0],[2400,0],[2100,4096],[1800,4096]]),
    ...layer('building', [[2800,500],[3700,500],[3700,1500],[2800,1500]]),
    ...layer('transportation', [[0,2200],[1700,1800],[4096,2400]], false)
  ]);
  const metadata = new Uint8Array(utf8(JSON.stringify({ name: 'SYNTHETIC PROOF — not a real map', attribution: 'Synthetic test geometry; no geographic coverage', vector_layers: ['landuse','park','water','building','transportation'].map(id => ({ id, fields: {} })) })));
  const directory = new Uint8Array([1, ...varint(zxyToTileId(z, x, y)), 1, ...varint(tile.length), 1]);
  const tileOffset = 127 + directory.length + metadata.length;
  const bytes = new Uint8Array(tileOffset + tile.length), view = new DataView(bytes.buffer);
  bytes.set(utf8('PMTiles')); bytes[7] = 3;
  for (const [offset, value] of [[8,127],[16,directory.length],[24,127+directory.length],[32,metadata.length],[40,tileOffset],[48,0],[56,tileOffset],[64,tile.length],[72,1],[80,1],[88,1]]) view.setBigUint64(offset, BigInt(value), true);
  bytes.set([1,1,1,1,z,z], 96); // clustered, uncompressed, MVT, zoom range
  const lon = (tileX) => tileX / n * 360 - 180;
  const lat = (tileY) => Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n))) * 180 / Math.PI;
  const bounds = [lon(x), lat(y+1), lon(x+1), lat(y)];
  bounds.forEach((value, index) => view.setInt32(102 + index * 4, Math.round(value * 1e7), true));
  bytes[118] = z;
  view.setInt32(119, Math.round(PROOF_LOCATION.lng * 1e7), true);
  view.setInt32(123, Math.round(PROOF_LOCATION.lat * 1e7), true);
  bytes.set(directory, 127); bytes.set(metadata, 127 + directory.length); bytes.set(tile, tileOffset);
  return { bytes, tile, z, x, y, bounds };
}
