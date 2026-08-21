import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const reportDir = path.join(root, 'research', 'appalachian-corridor-lab', '2026-08-20');
const inventory = JSON.parse(await readFile(path.join(reportDir, 'official-parking-inventory-v20260820.json'), 'utf8'));
const centerline = JSON.parse(await readFile(path.join(reportDir, 'centerline-segment-v20260820.geojson'), 'utf8'));
const health = JSON.parse(await readFile(path.join(reportDir, 'source-health-matrix-v20260820.json'), 'utf8'));
const generatedAt = inventory.retrievedAt;
const parking = inventory.records.map((record) => ({
  rank: record.rank,
  accessPoint: record.officialNames[0],
  distanceMeters: record.distanceToCenterlineMeters,
  longitude: record.coordinates[0],
  latitude: record.coordinates[1],
  objectId: record.objectId,
  priorityBand: record.priorityBand
}));
const sourceRows = health.sources.map((source) => ({ source: source.name, httpStatus: source.status, healthy: source.healthy ? 'yes' : 'no', latencyMs: source.latencyMs, freshnessSlaHours: source.freshnessSlaHours }));
const artifact = {
  surface: 'report',
  manifest: {
    version: 1, surface: 'report', title: 'Appalachian Corridor Lab upstream research', description: 'Technical evidence package for correcting the lab geometry and preserving promotion gates.', generatedAt,
    cards: [],
    charts: [{ id: 'parking_distance', title: 'Official parking distance to authoritative centerline', subtitle: 'Support-envelope screening distance in metres; proximity does not establish public access.', type: 'bar', dataset: 'parking', sourceId: 'parking_inventory', valueFormat: 'number', encodings: { x: { field: 'accessPoint', type: 'nominal', label: 'Official access point' }, y: { field: 'distanceMeters', type: 'quantitative', label: 'Distance (m)' }, tooltip: [{ field: 'objectId', type: 'nominal', label: 'Source object ID' }, { field: 'priorityBand', type: 'quantitative', label: 'Research priority band' }] } }],
    tables: [{ id: 'source_health', title: 'Source health probes', subtitle: 'Observed during the 20 August 2026 package build.', dataset: 'source_health', sourceId: 'health_matrix', defaultSort: { field: 'source', direction: 'asc' }, columns: [{ field: 'source', label: 'Source', type: 'text' }, { field: 'httpStatus', label: 'HTTP status', format: 'number' }, { field: 'healthy', label: 'Healthy', type: 'text' }, { field: 'latencyMs', label: 'Latency (ms)', format: 'number' }, { field: 'freshnessSlaHours', label: 'SLA (hours)', format: 'number' }] }],
    sources: [{ id: 'parking_inventory', label: 'Official parking inventory', path: 'official-parking-inventory-v20260820.json' }, { id: 'centerline_geometry', label: 'Authoritative centerline segment', path: 'centerline-segment-v20260820.geojson' }, { id: 'health_matrix', label: 'Source health matrix', path: 'source-health-matrix-v20260820.json' }],
    blocks: [
      { id: 'title', type: 'markdown', body: '# Appalachian Corridor Lab upstream research' },
      { id: 'technical_summary', type: 'markdown', body: `## The current tight envelope is the wrong slice\n\nThe named Bears Den / Snickers Gap focus sits east of the existing route envelope. Pulling the authoritative centerline across the support envelope replaces 6–13 km false connection distances with ${Math.min(...parking.map((row) => row.distanceMeters))}–${Math.max(...parking.map((row) => row.distanceMeters))} m screening distances. This makes geometric review possible, but **zero entries are editor-verified and zero walkable windows should be emitted**.`, sourceId: 'parking_inventory' },
      { id: 'findings', type: 'markdown', body: `## The corrected network creates a usable research base\n\nThe package contains ${centerline.metadata.supportFeatureCount} centerline features, ${centerline.metadata.vertexCount.toLocaleString()} vertices, ${parking.length} unique official parking records, six access-evidence seeds, and 17 natural endpoint candidates. These are research records, not live access claims.`, sourceId: 'centerline_geometry' },
      { id: 'chart_note', type: 'markdown', body: 'The distance chart shows geometric plausibility only. Snickers Gap is almost coincident with the corrected centerline, while several support-envelope lots require longer connector review. Every bar still needs current access, closure, and connection-method evidence.' },
      { id: 'parking_chart', type: 'chart', chartId: 'parking_distance', layout: 'full' },
      { id: 'scope', type: 'markdown', body: '## Scope and definitions\n\n**Research region:** the configured support envelope, not an administrative boundary. **Distance:** point-to-line-segment screening distance in a local equirectangular projection. **Verified entry:** an official access record with current public-access, closure, connector, and editor evidence; none currently qualify.' },
      { id: 'methods', type: 'markdown', body: '## Method preserves authority and unknowns\n\nNPS/ATC ArcGIS geometry was requested in EPSG:4326 and clipped server-side. Parking records retain raw attributes and source object IDs. Named lab locations rank first, followed by geometric proximity. Unknown access, capacity, surface, closures, and relocation status remain null or explicitly unresolved.' },
      { id: 'health_note', type: 'markdown', body: 'Source health is mixed: official ArcGIS services, Nominatim, and ATC pages responded successfully; the primary Overpass probe returned HTTP 406. Fallback success does not clear the OSM source-health blocker.' },
      { id: 'health_table', type: 'table', tableId: 'source_health', layout: 'full' },
      { id: 'limitations', type: 'markdown', body: '## Access remains the binding limitation\n\nGeometry cannot prove that parking is currently public, open, safe, or legally connected to the trail. The Snickers Gap county memorandum is useful research evidence but still requires a current review. No structured relocation or corridor-closure feed was established. Events and volunteer opportunities remain source-only because the four-field promotion contract is not reliably available.' },
      { id: 'next_steps', type: 'markdown', body: '## Redefine the micro-region before resuming automation\n\n1. Split the existing Morgan Mill slice from the intended Bears Den / Snickers Gap lab.\n2. Review current access and connector evidence for Bears Den and Snickers Gap.\n3. Bind a 15–40 minute window only after one entry is editor-verified.\n4. Apply the versioned urban research template independently to DC and Richmond.' },
      { id: 'questions', type: 'markdown', body: '## Questions that determine promotion readiness\n\n- Which authority owns the current-access decision for each lot?\n- Is there a reliable official closure or relocation feed for this corridor?\n- Should Bears Den / Snickers Gap become the first micro-region while Morgan Mill remains a separate lab?' }
    ]
  },
  snapshot: { version: 1, generatedAt, status: 'partial', datasets: { parking, source_health: sourceRows }, accessIssues: [{ id: 'current_access_unverified', dataset: 'parking', message: 'Current public access, closure, and connector evidence is incomplete; no entry is promotion-ready.' }] },
  sources: [
    { id: 'parking_inventory', query: { engine: 'duckdb', language: 'sql', sql: "SELECT rank, officialNames[1] AS accessPoint, distanceToCenterlineMeters AS distanceMeters, coordinates[1] AS longitude, coordinates[2] AS latitude, objectId, priorityBand FROM UNNEST((SELECT records FROM read_json_auto('official-parking-inventory-v20260820.json'))) AS t", description: 'Shapes the reviewed official NPS/ATC parking inventory for the report.', url: inventory.source.clippedQuery, executed_at: generatedAt, tables_used: ['official-parking-inventory-v20260820.json', 'ANST_Facilities/FeatureServer/2'], filters: ['supportBounds', 'parking/access attributes retained'] } },
    { id: 'centerline_geometry', query: { engine: 'ArcGIS FeatureServer', description: 'Official Appalachian Trail centerline clipped to the support envelope.', url: centerline.metadata.serviceUrl, executed_at: generatedAt, tables_used: ['ANST_Centerline/FeatureServer/0'], filters: ['supportBounds'], metric_definitions: { distanceMeters: 'Minimum point-to-line-segment distance in a local equirectangular projection.' } } },
    { id: 'health_matrix', query: { engine: 'duckdb', language: 'sql', sql: "SELECT name AS source, status AS httpStatus, CASE WHEN healthy THEN 'yes' ELSE 'no' END AS healthy, latencyMs, freshnessSlaHours FROM UNNEST((SELECT sources FROM read_json_auto('source-health-matrix-v20260820.json'))) AS t", description: 'Shapes one bounded health probe per external source used by the research package.', executed_at: health.retrievedAt, tables_used: ['source-health-matrix-v20260820.json'], filters: ['single observed run; not historical uptime'] } }
  ]
};
await writeFile(path.join(reportDir, 'artifact.json'), JSON.stringify(artifact, null, 2));
console.log(path.join(reportDir, 'artifact.json'));
