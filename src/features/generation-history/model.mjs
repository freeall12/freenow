import {isGenerationMediaRef, isLocalMediaSource} from '../generation-results/media-ref.mjs';
import {mediaSource} from '../media-preview/provenance.mjs';
const parameterKeys = ['model','modelId','provider','ratio','aspectRatio','aspect','resolution','quality','count','duration','durationMs','seed','negativePrompt','outputType','representation','modelType','isPano','material','tripoParams','voice','voiceId','language','speed','format','camera','lens','focal','aperture','cameraEnabled'];
const unsafeKey = /token|secret|password|authorization|credential|api.?key/i;
export function safeValue(value, depth = 0) {
  if (depth > 5) return undefined;
  if (typeof value === 'string') return value.slice(0, 12000);
  if (typeof value === 'boolean' || value === null || typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => safeValue(item, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).filter(([key]) => !unsafeKey.test(key)).map(([key, item]) => [key, safeValue(item, depth + 1)]).filter(([,item]) => item !== undefined));
}
export function parameters(value = {}) { return Object.fromEntries(parameterKeys.filter(key => value[key] !== undefined).map(key => [key, safeValue(value[key])]).filter(([,item]) => item !== undefined)); }
export function safeSource(source) {
  if (typeof source !== 'string') return null;
  if (isLocalMediaSource(source)) return source;
  if (!/^https?:/.test(source)) return null;
  try { const url = new URL(source); if (url.username || url.password || [...url.searchParams.keys()].some(key => unsafeKey.test(key))) return null; return source; } catch { return null; }
}
function worldSnapshot(output) {
  const invalid=()=>{throw Error('历史世界结果元数据无效，未保存可恢复结果');};
  const shape=(value,allowed,required=[])=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))invalid();};
  const resource=(value,{information=false}={})=>{
    if(!information&&isGenerationMediaRef(value))return;
    if(typeof value!=='string'||!value||value.length>8192||/[\x00-\x20\x7f]/.test(value))invalid();
    let url;try{url=new URL(value);}catch{invalid();}
    const host=url.hostname.toLowerCase().replace(/\.$/,'');
    if(url.protocol!=='https:'||url.username||url.password||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^(?:0|10|127|169\.254|192\.168|198\.(?:18|19))\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)||/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)||/^(?:22[4-9]|23\d|24\d|25[0-5])\./.test(host))invalid();
  };
  const world=output.world,resolutions=['100k','150k','500k','full_res'];
  if(output.type!=='model'||output.format!=='spz'||output.representation!=='gaussianSplat')invalid();
  shape(world,['worldId','model','marbleUrl','assets','coordinateSystem','splatResolution'],['worldId','model','marbleUrl','assets','coordinateSystem','splatResolution']);
  if(typeof world.worldId!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(world.worldId)||['.','..'].includes(world.worldId)||world.worldId!==output.sourceFileId||!['marble-1.1','marble-1.1-plus','marble-1.0','marble-1.0-draft'].includes(world.model)||world.coordinateSystem!=='marble_raw_opencv'||!resolutions.includes(world.splatResolution))invalid();
  resource(output.url);resource(world.marbleUrl,{information:true});if(output.poster!==undefined)resource(output.poster);
  shape(world.assets,['splats','mesh','imagery'],['splats']);
  const splats=world.assets.splats;shape(splats,['spzUrls','semanticsMetadata'],['spzUrls','semanticsMetadata']);shape(splats.spzUrls,resolutions,[world.splatResolution]);
  if(splats.spzUrls[world.splatResolution]!==output.url)invalid();for(const value of Object.values(splats.spzUrls))resource(value);
  shape(splats.semanticsMetadata,['metricScaleFactor','groundPlaneOffset'],['metricScaleFactor','groundPlaneOffset']);
  if(!Number.isFinite(splats.semanticsMetadata.metricScaleFactor)||splats.semanticsMetadata.metricScaleFactor<=0||!Number.isFinite(splats.semanticsMetadata.groundPlaneOffset))invalid();
  if(world.assets.mesh!==undefined){shape(world.assets.mesh,['colliderMeshUrl','fullResMeshUrl','hqMeshUrl']);for(const value of Object.values(world.assets.mesh))resource(value);}
  if(world.assets.imagery!==undefined){shape(world.assets.imagery,['panoUrl'],['panoUrl']);resource(world.assets.imagery.panoUrl);}
  // Exact shapes and URL/string bounds keep the nested record small. Signed
  // resource queries are retained verbatim for original-result archive retries.
  return structuredClone(world);
}
export function outputSnapshot(output) {
  const type = output?.type;
  if (!['image','video','audio','model'].includes(type)) return null;
  const world=output.world!==undefined||type==='model'&&output.format==='spz'?worldSnapshot(output):null;
  const source = world?output.url:safeSource(['image','video'].includes(type) ? mediaSource(output) : output.url || output[type]);
  const result = {type, ...(source ? {url: source} : {})};
  if(world)result.world=world;
  if (typeof output.model === 'string' && output.model.trim()) result.model = safeValue(output.model.trim());
  for (const key of ['title','filename','format','sourceFileId','width','height','duration','representation','mime']) if (output[key] !== undefined) result[key] = safeValue(output[key]);
  if(type==='video'&&output.sourceRange){const {start,end}=output.sourceRange;if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start){result.sourceRange={start,end};if(typeof output.text==='string')result.text=output.text.slice(0,12000);}}
  if(output.asset_metadata){const metadata=output.asset_metadata;result.asset_metadata=Object.fromEntries(['format','representation','name','bytes','model','outputType'].filter(key=>metadata[key]!==undefined).map(key=>[key,safeValue(metadata[key])]));}
  for(const key of ['image','fullImage','video','audio','sourceUrl','poster']) {const source=safeSource(output[key]);if(source)result[key]=source;}
  return result;
}
export function receipt(job, projectId, recoverable = false) {
  if (!job?.id || !job.request?.kind || !Number.isFinite(new Date(job.createdAt).getTime())) throw Error('生成任务缺少真实标识或日期');
  return {taskId: job.id, projectId, createdAt: new Date(job.createdAt).toISOString(), kind: job.request.kind, sourceNodeId: job.request.nodeId || null,
    prompt: typeof job.request.prompt === 'string' ? job.request.prompt.slice(0, 12000) : '', parameters: parameters(job.request.parameters), recoverable, status: job.status || 'queued'};
}
export function listRows(rows, {type, search = ''} = {}) {
  const query = search.trim().toLocaleLowerCase();
  return rows.filter(row => (!type || row.type === type) && (!query || [row.prompt,row.title,row.model,row.taskId].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)))
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.outputIndex - b.outputIndex || a.id.localeCompare(b.id));
}
export function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    // Receipts keep their UTC instant; group by the same local calendar day
    // shown in the media preview rather than slicing the persisted ISO string.
    const local = new Date(row.createdAt), date = Number.isFinite(local.getTime())
      ? [local.getFullYear(),String(local.getMonth()+1).padStart(2,'0'),String(local.getDate()).padStart(2,'0')].join('-')
      : '日期未知';
    if (!groups.has(date)) groups.set(date,[]);
    groups.get(date).push(row);
  }
  return [...groups];
}
