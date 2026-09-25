import { routeRuntimeGraph } from './runtime-router.mjs';


const graphs = new Map();
const reportWorkerError = (error) => self.postMessage({ type: 'worker-error', message: error?.message || String(error), stack: error?.stack || null });
self.addEventListener('error', (event) => reportWorkerError(event.error || event.message));
self.addEventListener('unhandledrejection', (event) => reportWorkerError(event.reason));
self.onmessage = async ({ data }) => {
  if (data?.type !== 'route') return;
  try { self.postMessage({ requestId: data.requestId, result: routeRuntimeGraph(await loadGraph(data.cell, data.requestId, data.cellRelease, data.cellId), data) }); }
  catch (e) { self.postMessage({ requestId: data.requestId, result: { ok:false, status:e.code || 'GRAPH_VERSION_UNAVAILABLE', failure:{ type:e.code || 'GRAPH_VERSION_UNAVAILABLE', message:e.message } } }); }
};
const report=(id,phase,completed,total)=>self.postMessage({type:'progress',requestId:id,phase,completed,total});
const fail=(code,message)=>Object.assign(new Error(message),{code});
async function loadGraph(cell,id,release,cellId) {
  const key=`${release}/${cellId}`; if(graphs.has(key)) return graphs.get(key);
  if(!cell?.artifacts) throw fail('GRAPH_VERSION_UNAVAILABLE','Routing cell artifacts are missing.');
  const ma=cell.artifacts.manifest || cell.artifacts.graphManifest; const manifest=ma ? await json(ma.url) : cell.metadata || {};
  if(manifest.schema_version!==1 || manifest.graph_version!=='motherbird-runtime-graph-v1') throw fail('GRAPH_VERSION_UNAVAILABLE','Binary routing manifest is incompatible.');
  const names=['nodes','edges','adjacency','edge_geometry','edge_spatial_index']; const b={}; report(id,'fetching',0,5);
  for(let i=0;i<names.length;i++){const n=names[i], a=cell.artifacts[n]||cell.artifacts[`${n}.bin`]; if(!a?.url) throw fail('GRAPH_VERSION_UNAVAILABLE',`Binary artifact ${n} is missing.`); b[n]=await bytes(a,manifest.artifacts?.[`${n}.bin`]||a); report(id,'fetching',i+1,5);}
  report(id,'decoding',0,5); const nodes=readNodes(b.nodes); report(id,'decoding',1,5); const edges=readEdges(b.edges,manifest); report(id,'decoding',2,5); const adjacency=readAdj(b.adjacency); report(id,'decoding',3,5); const geometry=readGeometry(b.edge_geometry); report(id,'decoding',4,5); const spatial_index=readSpatial(b.edge_spatial_index); report(id,'decoding',5,5);
  const runtime={...manifest,nodes,edges,adjacency,geometry,spatial_index,sources:manifest.sources||[],source_names:manifest.source_names||[],edge_types:manifest.edge_types||['unknown','sidewalk','footpath','crossing','trail','pedestrian_plaza','indoor_pathway','pedestrian_link']}; graphs.set(key,runtime); report(id,'ready',5,5); return runtime;
}
async function json(url){const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw fail('GRAPH_VERSION_UNAVAILABLE',`Routing manifest returned HTTP ${r.status}.`);return r.json();}
async function bytes(a,e){const r=await fetch(a.url,{credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw fail('GRAPH_VERSION_UNAVAILABLE',`Routing artifact returned HTTP ${r.status}.`);const blob=await r.blob();if(e.bytes!=null&&blob.size!==Number(e.bytes))throw fail('GRAPH_ARTIFACT_MISMATCH','Routing artifact size does not match its manifest.');if(e.sha256){const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');if(h!==e.sha256.replace(/^sha256:/,''))throw fail('GRAPH_ARTIFACT_MISMATCH','Routing artifact checksum does not match its manifest.');}return blob.arrayBuffer();}
function dat(b){return new DataView(b)} function head(d,s){if(String.fromCharCode(...new Uint8Array(d.buffer,0,4))!==s)throw fail('GRAPH_VERSION_UNAVAILABLE',`Invalid ${s} routing binary.`)}
function readNodes(b){const d=dat(b);head(d,'MBN1');const n=d.getUint32(4,true);return Array.from({length:n},(_,i)=>{const o=8+i*12;return[i,d.getInt32(o,true),d.getInt32(o+4,true),d.getInt16(o+8,true),d.getUint16(o+10,true)]})}
function readEdges(b,m){const d=dat(b);head(d,'MBE1');const n=d.getUint32(4,true);return Array.from({length:n},(_,i)=>{const o=8+i*40;return[m.edge_ids?.[i]||`edge:${i}`,d.getUint32(o,true),d.getUint32(o+4,true),d.getUint32(o+8,true),d.getUint32(o+12,true),d.getUint8(o+16),d.getUint8(o+17),d.getUint8(o+18),d.getUint32(o+20,true),d.getUint32(o+24,true),d.getUint32(o+28,true),d.getUint8(o+19)]})}
function readAdj(b){const d=dat(b);head(d,'MBA1');const n=d.getUint32(4,true),s=Array.from({length:n+1},(_,i)=>d.getUint32(12+i*4,true)),base=12+(n+1)*4;return Array.from({length:n},(_,i)=>Array.from({length:s[i+1]-s[i]},(_,j)=>({edge_index:d.getUint32(base+(s[i]+j)*8,true),node_index:d.getUint32(base+(s[i]+j)*8+4,true)})))}
function readGeometry(b){const d=dat(b);head(d,'MBG1');return Array.from({length:d.getUint32(4,true)},(_,i)=>d.getInt32(8+i*4,true))}
function readSpatial(b){const d=dat(b);head(d,'MBS1');const size=d.getUint32(4,true),n=d.getUint32(8,true),out={type:'fixed_grid_edge_bbox',cell_size_e7:size,buckets:{}},base=16+n*16;for(let i=0;i<n;i++){const o=16+i*16,x=d.getInt32(o,true),y=d.getInt32(o+4,true),off=d.getUint32(o+8,true),c=d.getUint32(o+12,true);out.buckets[`${x}:${y}`]=Array.from({length:c},(_,j)=>d.getUint32(base+(off+j)*4,true))}return out}
