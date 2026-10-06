import { routeRuntimeGraph } from './runtime-router.mjs?v=20261006-routing-recovery-1';
import { WalkingCellCache } from './walking-cell-cache.js';


const graphs = new Map();
const graphLoads = new Map();
const persistentCache = new WalkingCellCache();
const MAX_GRAPH_CACHE_BYTES = 256 * 1024 * 1024;
let graphCacheBytes = 0;
const reportWorkerError = (error) => self.postMessage({ type: 'worker-error', message: error?.message || String(error), stack: error?.stack || null, phase: workerPhase });
let workerPhase = 'idle';
const phase = (value) => { workerPhase = value; };
self.addEventListener('error', (event) => reportWorkerError(event.error || event.message));
self.addEventListener('unhandledrejection', (event) => reportWorkerError(event.reason));
self.postMessage({ type: 'worker-ready', phase: workerPhase });
self.onmessage = async ({ data }) => {
  if (data?.type !== 'route') return;
  try {
    phase('loadGraph');
    const runtime = await loadGraph(data.cell, data.requestId, data.cellRelease, data.cellId);
    phase('route');
    self.postMessage({ requestId: data.requestId, result: routeRuntimeGraph(runtime, data, { maxSnapMeters: data.maxSnapMeters }) });
    phase('idle');
  }
  catch (e) { self.postMessage({ requestId: data.requestId, result: { ok:false, status:e.code || 'GRAPH_VERSION_UNAVAILABLE', failure:{ type:e.code || 'GRAPH_VERSION_UNAVAILABLE', message:e.message, phase: workerPhase } } }); phase('idle'); }
};
const report=(id,phase,completed,total)=>self.postMessage({type:'progress',requestId:id,phase,completed,total});
const fail=(code,message)=>Object.assign(new Error(message),{code});
async function loadGraph(cell,id,release,cellId) {
  const version = cell?.graphHash || cell?.graphVersion || cell?.artifacts?.manifest?.sha256 || 'unversioned';
  const key=`${release}/${cellId}/${version}`;
  const cached = graphs.get(key);
  if (cached) { cached.lastUsed = performance.now(); return cached.runtime; }
  if (graphLoads.has(key)) return graphLoads.get(key);
  const load = loadGraphUncached(cell,id,release,cellId,key);
  graphLoads.set(key, load);
  try { return await load; } finally { graphLoads.delete(key); }
}
async function loadGraphUncached(cell,id,release,cellId,key) {
  if(!cell?.artifacts) throw fail('GRAPH_VERSION_UNAVAILABLE','Routing cell artifacts are missing.');
  const ma=cell.artifacts.manifest || cell.artifacts.graphManifest; let manifest=ma ? await json(ma.url) : cell.metadata || {};
  // The HF pilot registry points at its build summary rather than the
  // binary-package manifest. Reconstruct the small manifest needed by the
  // binary loader and derive the sibling edge metadata artifact; this keeps
  // routing on the compact binary path instead of parsing a 400+ MB JSON graph.
  if (manifest.schema_version !== 1 && manifest.graphVersion === 'motherbird-runtime-graph-v1' && cell.artifacts['nodes.bin']) {
    const base = new URL(ma.url);
    const artifact = (name) => cell.artifacts[`${name}.bin`] || cell.artifacts[name];
    manifest = {
      schema_version: 1,
      dataset_id: `${release}:${cellId}`,
      graph_version: manifest.graphVersion,
      policy_version: '2026-08-27.1',
      graph_hash: manifest.graphHash,
      edge_types: ['unknown','sidewalk','footpath','crossing','trail','pedestrian_plaza','indoor_pathway','pedestrian_link'],
      artifacts: {
        'nodes.bin': artifact('nodes'), 'edges.bin': artifact('edges'),
        'adjacency.bin': artifact('adjacency'), 'edge_geometry.bin': artifact('edge_geometry'),
        'edge_spatial_index.bin': artifact('edge_spatial_index'),
        'edge_metadata.json.gz': { url: new URL('edge_metadata.json.gz', base).href }
      },
      pilot_binary: true
    };
  }
  // The Northern Virginia/DC HF pilot publishes a compact build summary as
  // its manifest and the complete runtime graph as a sibling artifact. Use
  // that graph directly when the summary is not the binary-package manifest.
  if (cell.artifacts.graph && (manifest.schema_version !== 1 || manifest.graph_version !== 'motherbird-runtime-graph-v1')) {
    const runtime = await json(cell.artifacts.graph.url);
    if (runtime?.graph_version !== 'motherbird-runtime-graph-v1' && (runtime?.schema_version !== 1 || runtime?.format !== 'motherbird-runtime-graph-v1')) throw fail('GRAPH_VERSION_UNAVAILABLE','HF runtime graph is incompatible.');
    const sourceRelease = cell.sourceRelease || release;
    if (runtime.source_version !== release && runtime.source_version !== sourceRelease) throw fail('GRAPH_ARTIFACT_MISMATCH','HF runtime graph metadata does not match its registry entry.');
    if (runtime.dataset_id !== `${release}:${cellId}` && runtime.dataset_id !== `${runtime.source_version}:${cellId}`) throw fail('GRAPH_ARTIFACT_MISMATCH','HF runtime graph dataset identity does not match its registry entry.');
    return runtime;
  }
  if(manifest.schema_version!==1 || manifest.graph_version!=='motherbird-runtime-graph-v1') throw fail('GRAPH_VERSION_UNAVAILABLE','Binary routing manifest is incompatible.');
  const names=['nodes','edges','adjacency','edge_geometry','edge_spatial_index','edge_metadata']; report(id,'fetching',0,names.length);
  const loadArtifact = async (n) => { const manifestName=n==='edge_metadata'?'edge_metadata.json.gz':`${n}.bin`; const a=cell.artifacts[n]||cell.artifacts[manifestName]; if(!a?.url && n !== 'edge_metadata') throw fail('GRAPH_VERSION_UNAVAILABLE',`Binary artifact ${n} is missing.`); return a?.url ? (manifest.pilot_binary ? bytes(a, manifest.artifacts?.[manifestName] || a) : loadBinary(release, cell, n, a, manifest.artifacts?.[manifestName])) : null; };
  let nodesBuffer=await loadArtifact('nodes'); report(id,'fetching',1,names.length); report(id,'decoding',0,6); const nodes=readNodes(nodesBuffer); nodesBuffer=null; report(id,'decoding',1,6);
  let edgesBuffer=await loadArtifact('edges'); report(id,'fetching',2,names.length); const metadata=manifest.pilot_binary ? {} : await readMetadata(await loadArtifact('edge_metadata')); const edges=readEdges(edgesBuffer,{...manifest,...metadata}); edgesBuffer=null; report(id,'decoding',2,6);
  let adjacencyBuffer=await loadArtifact('adjacency'); const adjacency=readAdj(adjacencyBuffer); adjacencyBuffer=null; report(id,'fetching',3,names.length); report(id,'decoding',3,6);
  let geometryBuffer=await loadArtifact('edge_geometry'); const geometry=readGeometry(geometryBuffer,edges); geometryBuffer=null; report(id,'fetching',4,names.length); report(id,'decoding',4,6);
  let spatialBuffer=await loadArtifact('edge_spatial_index'); const spatial_index=readSpatial(spatialBuffer); spatialBuffer=null; report(id,'fetching',5,names.length); report(id,'decoding',5,6);
  const runtime={...manifest,...metadata,nodes,edges,adjacency,geometry,spatial_index,edge_types:manifest.edge_types||['unknown','sidewalk','footpath','crossing','trail','pedestrian_plaza','indoor_pathway','pedestrian_link']};
  const graphBytes = Object.values(manifest.artifacts || {}).reduce((sum, artifact) => sum + Number(artifact.bytes || 0), 0);
  const entry = { runtime, bytes: Math.max(graphBytes * 2, 1), lastUsed: performance.now() };
  const previous = graphs.get(key); if (previous) graphCacheBytes -= previous.bytes;
  graphs.set(key, entry); graphCacheBytes += entry.bytes; evictGraphs(key);
  report(id,'ready',6,6); return runtime;
}
async function readMetadata(buffer) {
  if (!buffer) return {};
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
async function loadBinary(release, cell, kind, artifact, manifestArtifact) {
  const verifiedArtifact = { ...artifact, ...(manifestArtifact || {}) };
  // Adaptive HF pilot packages are already compact, immutable binary cells.
  // Avoid Blob -> OPFS File -> ArrayBuffer duplication in the worker; that
  // transient amplification can terminate a browser worker on large shards.
  if (cell.artifacts?.['nodes.bin'] || cell.artifacts?.nodes) return bytes(artifact, manifestArtifact || artifact);
  const cacheCell = { ...cell, artifacts: { [kind]: verifiedArtifact } };
  try {
    const file = await persistentCache.ensure(release, cacheCell, kind);
    return file.arrayBuffer();
  } catch (error) {
    if (!isCacheInfrastructureError(error)) throw error;
    return bytes(artifact, manifestArtifact || artifact);
  }
}
function isCacheInfrastructureError(error) {
  return error?.name === 'QuotaExceededError'
    || /origin private file system is unavailable|quota|storage/i.test(error?.message || '');
}
function evictGraphs(protectedKey) {
  while (graphCacheBytes > MAX_GRAPH_CACHE_BYTES && graphs.size > 1) {
    let oldestKey = null; let oldestTime = Infinity;
    for (const [key, entry] of graphs) if (key !== protectedKey && entry.lastUsed < oldestTime) { oldestKey = key; oldestTime = entry.lastUsed; }
    if (!oldestKey) break;
    graphCacheBytes -= graphs.get(oldestKey).bytes; graphs.delete(oldestKey);
  }
}
async function json(url){const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw fail('GRAPH_VERSION_UNAVAILABLE',`Routing manifest returned HTTP ${r.status}.`);return r.json();}
async function bytes(a,e){const r=await fetch(a.url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw fail('GRAPH_VERSION_UNAVAILABLE',`Routing artifact returned HTTP ${r.status}.`);const blob=await r.blob();if(e.bytes!=null&&blob.size!==Number(e.bytes))throw fail('GRAPH_ARTIFACT_MISMATCH','Routing artifact size does not match its manifest.');const buffer=await blob.arrayBuffer();if(e.sha256){const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');if(h!==e.sha256.replace(/^sha256:/,''))throw fail('GRAPH_ARTIFACT_MISMATCH','Routing artifact checksum does not match its manifest.');}return buffer;}
function dat(b){return new DataView(b)} function head(d,s){if(String.fromCharCode(...new Uint8Array(d.buffer,0,4))!==s)throw fail('GRAPH_VERSION_UNAVAILABLE',`Invalid ${s} routing binary.`)}
function readNodes(b){const d=dat(b);head(d,'MBN1');const n=d.getUint32(4,true),latE7=new Int32Array(n),lonE7=new Int32Array(n);for(let i=0;i<n;i++){const o=8+i*12;latE7[i]=d.getInt32(o,true);lonE7[i]=d.getInt32(o+4,true);}return{length:n,latE7,lonE7}}
function readEdges(b,m){const d=dat(b);head(d,'MBE1');const n=d.getUint32(4,true),ids=m.edge_ids||[];const data=new Proxy({}, { get(_target, property) { const index=Number(property); if(!Number.isInteger(index)||index<0||index>=n*12) return undefined; const edge=Math.floor(index/12), field=index%12, o=8+edge*40; if(field===0)return edge; if(field>=1&&field<=4)return d.getUint32(o+(field-1)*4,true); if(field===5||field===6||field===7)return d.getUint8(o+11+field); if(field===8)return d.getUint32(o+20,true); if(field===9)return d.getUint32(o+24,true); if(field===10)return d.getUint32(o+28,true); if(field===11)return d.getUint8(o+19); return undefined; }}); return{count:n,data,ids}}
function readAdj(b){const d=dat(b);head(d,'MBA1');const n=d.getUint32(4,true),offsets=new Uint32Array(b,12,n+1),count=offsets[n],base=12+(n+1)*4;const view=(shift)=>new Proxy({}, { get(_target, property) { const index=Number(property); return Number.isInteger(index)&&index>=0&&index<count ? d.getUint32(base+index*8+shift,true) : undefined; }});return{offsets,edgeIndexes:view(0),nodeIndexes:view(4)}}
function readGeometry(b,edges){const d=dat(b);head(d,'MBG1');const n=d.getUint32(4,true),geometry=new Int32Array(b,8,n);for(let edgeIndex=0;edgeIndex<edges.count;edgeIndex++){const offset=edges.data[edgeIndex*12+9]*2;const count=edges.data[edgeIndex*12+10]*2;for(let i=offset+2;i<offset+count;i+=2){geometry[i]+=geometry[i-2];geometry[i+1]+=geometry[i-1];}}return geometry}
function readSpatial(b){const d=dat(b);head(d,'MBS1');const size=d.getUint32(4,true),n=d.getUint32(8,true),out={type:'fixed_grid_edge_bbox',cell_size_e7:size,buckets:{}},base=16+n*16;for(let i=0;i<n;i++){const o=16+i*16,x=d.getInt32(o,true),y=d.getInt32(o+4,true),off=d.getUint32(o+8,true),c=d.getUint32(o+12,true);out.buckets[`${x}:${y}`]=Array.from({length:c},(_,j)=>d.getUint32(base+(off+j)*4,true))}return out}
