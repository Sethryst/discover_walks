// One palette drives the SVG swatch and the installed OpenMapTiles basemap.
// This is vector cartography, not satellite imagery or an AWS service.
export const OFFLINE_MAP_PRESETS = Object.freeze([
  { id: 'dark-satellite', name: 'Dark satellite', description: 'Satellite-inspired vectors · no imagery',
    colors: { paper: '#111c20', land: '#24362f', park: '#345043', water: '#122f42', stream: '#43768a', building: '#4c5554', outline: '#65716b', casing: '#192528', road: '#b2b9a4' } },
  { id: 'field-paper', name: 'Field paper', description: 'Light, ink-and-paper vectors',
    colors: { paper: '#edf1e4', land: '#e1ead6', park: '#cde0b9', water: '#a9d0df', stream: '#80b9cf', building: '#e4d8c4', outline: '#cfbea6', casing: '#f7f3ea', road: '#b39f7d' } }
]);
export const DEFAULT_OFFLINE_PRESET = OFFLINE_MAP_PRESETS[0].id;
export function offlineMapPreset(id = DEFAULT_OFFLINE_PRESET) {
  const preset = OFFLINE_MAP_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error('Unknown offline map preset.');
  return preset;
}
export function offlinePresetSvg(id) {
  const { colors: c } = offlineMapPreset(id);
  // Deliberately illustrative geometry, never presented as installed coverage.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 112" aria-hidden="true" focusable="false">
    <rect width="240" height="112" fill="${c.paper}"/>
    <path d="M0 0H145L131 25 97 39 104 65 59 79 0 63Z" fill="${c.land}"/>
    <path d="M0 7L59 0 90 16 73 34 84 53 52 70 0 57ZM158 77L187 62 240 82V112H149Z" fill="${c.park}"/>
    <path d="M151 0C112 28 159 35 126 61S131 92 99 112H121C152 85 139 80 149 65S150 35 158 24L173 0Z" fill="${c.water}"/>
    <g fill="${c.building}" stroke="${c.outline}" stroke-width=".7"><path d="M165 10h17v11h-17ZM190 18h25v14h-25ZM176 36h14v17h-14ZM211 42h20v12h-20ZM24 83h20v15H24ZM58 87h26v15H58Z"/></g>
    <path d="M-5 73L54 63 104 73 160 54 245 65M94-5L103 33 85 66 94 117" fill="none" stroke="${c.casing}" stroke-width="7"/>
    <path d="M-5 73L54 63 104 73 160 54 245 65M94-5L103 33 85 66 94 117" fill="none" stroke="${c.road}" stroke-width="2.5"/>
    <path d="M10 23L35 20 62 43 51 59" fill="none" stroke="${c.road}" stroke-width="1" stroke-dasharray="3 3"/>
  </svg>`;
}
export function installedTileStyle(sourceUrl, presetId = DEFAULT_OFFLINE_PRESET) {
  // Only FileSource protocol URLs, never remote sprites, glyphs, or imagery.
  if (typeof sourceUrl !== 'string' || !/^pmtiles:\/\/[^/]+\.pmtiles$/.test(sourceUrl)) throw new Error('Offline style requires an installed PMTiles file.');
  const { colors: c, id } = offlineMapPreset(presetId);
  return {
    version: 8, metadata: { offlinePreset: id },
    sources: { field: { type: 'vector', url: sourceUrl } },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': c.paper } },
      { id: 'landuse', type: 'fill', source: 'field', 'source-layer': 'landuse', paint: { 'fill-color': c.land, 'fill-opacity': 0.9 } },
      { id: 'landcover', type: 'fill', source: 'field', 'source-layer': 'landcover', paint: { 'fill-color': c.park, 'fill-opacity': 0.65 } },
      { id: 'park', type: 'fill', source: 'field', 'source-layer': 'park', paint: { 'fill-color': c.park, 'fill-opacity': 0.92 } },
      { id: 'water', type: 'fill', source: 'field', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'waterway', type: 'line', source: 'field', 'source-layer': 'waterway', paint: { 'line-color': c.stream, 'line-width': 1.4 } },
      { id: 'building', type: 'fill', source: 'field', 'source-layer': 'building', minzoom: 15, paint: { 'fill-color': c.building, 'fill-outline-color': c.outline } },
      { id: 'roads-casing', type: 'line', source: 'field', 'source-layer': 'transportation', paint: { 'line-color': c.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 6] } },
      { id: 'roads', type: 'line', source: 'field', 'source-layer': 'transportation', paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 18, 3.2] } }
    ]
  };
}
