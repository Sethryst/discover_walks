// All access goes through FileSource: these operations cannot download a pack.
export async function openInstalledTileArchive(file, pmtiles = globalThis.pmtiles) {
  if (!file || file.size <= 127) throw new Error('Installed PMTiles file is missing or is a placeholder.');
  const bytes = new Uint8Array(await file.slice(0, 127).arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 7)) !== 'PMTiles' || bytes[7] !== 3) throw new Error('Installed map is not a PMTiles v3 archive.');
  const view = new DataView(bytes.buffer);
  for (const offset of [8, 24, 40, 56]) {
    const start = view.getBigUint64(offset, true), length = view.getBigUint64(offset + 8, true);
    if (offset === 40 && length === 0n) continue; // optional leaf directories
    if (length === 0n || start < 127n || start + length > BigInt(file.size)) throw new Error('Installed PMTiles archive is truncated or has invalid sections.');
  }
  if (bytes[100] > bytes[101] || bytes[101] > 26) throw new Error('Installed PMTiles zoom range is unsupported.');
  if (!pmtiles?.PMTiles || !pmtiles?.FileSource) throw new Error('The offline PMTiles reader is unavailable.');
  const archive = new pmtiles.PMTiles(new pmtiles.FileSource(file));
  const header = await archive.getHeader();
  if (header.tileType !== 1) throw new Error('This preset requires MVT vector tiles, not imagery.');
  const metadata = await archive.getMetadata();
  if (!Array.isArray(metadata.vector_layers) || !metadata.vector_layers.length) throw new Error('Installed map has no vector layer metadata.');
  return { archive, header, metadata };
}
export async function probeInstalledTile(file, { lng, lat, zoom }, pmtiles = globalThis.pmtiles) {
  const { archive, header, metadata } = await openInstalledTileArchive(file, pmtiles);
  if (![lng, lat, zoom].every(Number.isFinite) || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new Error('Invalid tile probe position.');
  const z = Math.max(header.minZoom, Math.min(header.maxZoom, Math.floor(zoom)));
  const n = 2 ** z, latitude = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  const x = Math.max(0, Math.min(n - 1, Math.floor((lng + 180) / 360 * n)));
  const y = Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * n)));
  const tile = await archive.getZxy(z, x, y);
  if (!tile?.data?.byteLength) throw new Error(`No installed tile at ${z}/${x}/${y}. This location is not proven offline.`);
  return { z, x, y, bytes: tile.data.byteLength, layers: metadata.vector_layers.map((layer) => layer.id), minZoom: header.minZoom, maxZoom: header.maxZoom };
}
