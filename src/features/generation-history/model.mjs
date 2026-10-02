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
  if (/^(asset:|data:(image|video|audio)\/)/.test(source)) return source;
  if (!/^https?:/.test(source)) return null;
  try { const url = new URL(source); if (url.username || url.password || [...url.searchParams.keys()].some(key => unsafeKey.test(key))) return null; return source; } catch { return null; }
}
export function outputSnapshot(output) {
  const type = output?.type;
  if (!['image','video','audio','model'].includes(type)) return null;
  const source = safeSource(output.url || output[type]);
  const result = {type, ...(source ? {url: source} : {})};
  for (const key of ['title','filename','format','sourceFileId','width','height','duration','representation']) if (output[key] !== undefined) result[key] = safeValue(output[key]);
  if(type==='video'&&output.sourceRange){const {start,end}=output.sourceRange;if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start){result.sourceRange={start,end};if(typeof output.text==='string')result.text=output.text.slice(0,12000);}}
  if(output.asset_metadata){const metadata=output.asset_metadata;result.asset_metadata=Object.fromEntries(['format','representation','name','bytes','model','outputType'].filter(key=>metadata[key]!==undefined).map(key=>[key,safeValue(metadata[key])]));}
  if (safeSource(output.poster)) result.poster = safeSource(output.poster);
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
export function groupRows(rows) { const groups = new Map(); for (const row of rows) { const date = row.createdAt.slice(0,10); if (!groups.has(date)) groups.set(date,[]); groups.get(date).push(row); } return [...groups]; }
