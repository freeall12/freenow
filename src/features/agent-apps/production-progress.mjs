// Unmodified production-progress@v1.acd4e750.html: He/s_/c_/l_/d_/_m/ontoolresult.
export const productionProgressUri = 'ui://tapnow/production-progress@v1';
export const productionProgressTool = 'get_production_result';
export const productionProgressPolicy = Object.freeze({allowExpanded: false, autoExpandOnReady: false});
export const productionProgressTimeoutMs = 7200000;
export const productionProgressFailureLimit = 4;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = () => {throw Error('制作进度来源或查询结果无效');};
function fields(value, allowed) {if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();}
function text(value, limit, nonempty = true) {
  if (typeof value !== 'string' || value.length > limit || nonempty && !value.trim()) fail();
  try {encodeURIComponent(value);} catch {fail();}
  return value;
}
function url(value) {
  text(value, 4096);
  let parsed;try {parsed = new URL(value);} catch {fail();}
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail();
  return value;
}
function mediaUrl(value, mediaType) {
  if (typeof value !== 'string') fail();
  if (value.startsWith('blob:')) {
    text(value, 4096);url(value.slice(5));
    const nested = new URL(value.slice(5));
    if (!/^\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(nested.pathname) || nested.search || nested.hash) fail();
    return value;
  }
  if (value.startsWith('data:')) {
    if (mediaType === 'video') {
      if (value.length > 12 * 1024 * 1024) fail();
      const match = /^data:video\/(mp4|webm);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
      if (!match || match[2].length % 4) fail();
      let bytes;try {bytes = atob(match[2]);} catch {fail();}
      if (bytes.length > 8 * 1024 * 1024 || (match[1] === 'mp4' ? bytes.length < 12 || bytes.slice(4, 8) !== 'ftyp' : !bytes.startsWith('\x1a\x45\xdf\xa3'))) fail();
      return value;
    }
    if (value.length > 524288) fail();
    const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4) fail();
    let bytes;try {bytes = atob(match[2]);} catch {fail();}
    const signature = match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n') : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') : match[1] === 'gif' ? bytes.startsWith('GIF87a') || bytes.startsWith('GIF89a') : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
    if (!signature) fail();
    return value;
  }
  return url(value);
}
function nodeIds(value) {
  if (!Array.isArray(value) || value.length > 100) fail();
  const ids = value.map(value => text(value, 200));
  if (new Set(ids).size !== ids.length) fail();
  return ids;
}
export function isProductionProgressTerminal(status) {return status === 'done' || status === 'failed' || status === 'not_found';}

// This validates display data; only the host can prove it belongs to its actual
// saved generation trace. Model-written IDs are not a production receipt.
export function prepareProductionProgress(data, title = '制作进度') {
  fields(data, ['node_ids', 'project_id', 'project_url', 'status', 'reason']);text(title, 200);
  const result = {title, node_ids: nodeIds(data.node_ids)};
  if (data.project_id !== undefined) result.project_id = text(data.project_id, 200);
  if (data.project_url !== undefined) result.project_url = url(data.project_url);
  if (data.status !== undefined) {
    if (data.status !== 'blocked') fail();
    result.status = 'blocked';
  }
  if (data.reason !== undefined) {
    if (data.status !== 'blocked') fail();
    result.reason = text(data.reason, 200);
  }
  if (!result.node_ids.length && result.status !== 'blocked') fail();
  return result;
}
function prepared(response) {
  fields(response, ['title', 'node_ids', 'project_id', 'project_url', 'status', 'reason']);
  const {title, ...data} = response;
  return prepareProductionProgress(data, title);
}
export function validateProductionProgressRequest(args, response) {
  fields(args, ['node_ids', 'project_id']);
  const source = prepared(response), ids = nodeIds(args.node_ids);
  if (source.status === 'blocked' || !ids.length || JSON.stringify(ids) !== JSON.stringify(source.node_ids) || args.project_id !== source.project_id) fail();
  return {node_ids: ids, ...(source.project_id ? {project_id: source.project_id} : {})};
}
function item(value, source) {
  fields(value, ['node_id', 'status', 'media_type', 'media_url', 'title']);
  const node_id = text(value.node_id, 200);
  if (!source.node_ids.includes(node_id)) fail();
  const result = {node_id};
  if (value.status !== undefined) result.status = text(value.status, 64);
  if (value.media_type !== undefined) {
    if (!['image', 'video'].includes(value.media_type)) fail();
    result.media_type = value.media_type;
  }
  if (value.title !== undefined) result.title = text(value.title, 500, false);
  // The shipped UI only consumes media_url for done items. A pending preview
  // cannot become evidence of a completed or playable output.
  if (value.media_url !== undefined && value.media_url !== '') {
    const media = mediaUrl(value.media_url, value.media_type);
    if (value.status === 'done') result.media_url = media;
  }
  return result;
}
export function normalizeProductionProgressResult(result, response) {
  const source = prepared(response);
  if (source.status === 'blocked' || !source.node_ids.length) fail();
  fields(result, ['content', 'structuredContent', 'isError', '_meta']);
  if (result.isError !== undefined && typeof result.isError !== 'boolean') fail();
  if (result.isError === true) throw Error('制作进度查询失败，任务状态未变');
  const data = result.structuredContent;
  fields(data, ['items', 'status', 'project_url']);
  // Missing structuredContent/items is a refresh error, never invented not_found.
  if (!Array.isArray(data.items) || data.items.length > source.node_ids.length) fail();
  const items = data.items.map(value => item(value, source)), map = new Map(items.map(value => [value.node_id, value]));
  if (map.size !== items.length) fail();
  const normalized = {items: source.node_ids.map(node_id => map.get(node_id) || {node_id, status: 'not_found'})};
  if (data.status !== undefined) normalized.status = text(data.status, 64);
  if (data.project_url !== undefined) normalized.project_url = url(data.project_url);
  return {content: [], structuredContent: normalized};
}
function time(value) {if (!Number.isSafeInteger(value) || value < 0) fail();return value;}
export function createProductionProgressSession(upstreamResult, now = Date.now()) {
  fields(upstreamResult, ['content', 'structuredContent', 'isError', '_meta']);
  if (upstreamResult.isError !== undefined && typeof upstreamResult.isError !== 'boolean') fail();
  time(now);
  if (upstreamResult.isError === true) return {response: null, items: [], started_at: now, consecutive_errors: 0, stopped: true, timed_out: false, failure: {kind: 'error'}};
  const response = prepareProductionProgress(upstreamResult.structuredContent);
  const failure = response.status === 'blocked' ? {kind: 'blocked', ...(response.reason ? {reason: response.reason} : {})} : null;
  return {response, items: failure ? [] : response.node_ids.map(node_id => ({node_id})), started_at: now, consecutive_errors: 0, stopped: !!failure, timed_out: false, failure};
}
export function productionProgressPollDelay(session) {
  const pending = session.items.filter(value => !isProductionProgressTerminal(value.status));
  return !pending.length ? 15000 : pending.some(value => value.media_type === 'video') ? 45000 : 20000;
}
export function applyProductionProgressPoll(session, result, now = Date.now()) {
  time(now);
  if (now < session.started_at) fail();
  if (session.stopped) return structuredClone(session);
  const next = structuredClone(session);
  try {
    const data = normalizeProductionProgressResult(result, session.response).structuredContent;
    next.items = data.items;next.consecutive_errors = 0;
    if (data.project_url) next.response.project_url = data.project_url;
    next.stopped = next.items.every(value => isProductionProgressTerminal(value.status)) || isProductionProgressTerminal(data.status);
  } catch {
    next.consecutive_errors += 1;
    next.stopped = next.consecutive_errors >= productionProgressFailureLimit;
  }
  // Timeout and transport failure stop refreshing. They never change item status.
  if (!next.stopped && now - next.started_at >= productionProgressTimeoutMs) {next.stopped = true;next.timed_out = true;}
  return next;
}
export function summarizeProductionProgress(session) {
  const terminal = session.items.filter(value => isProductionProgressTerminal(value.status)).length;
  const failed = session.items.filter(value => value.status === 'failed' || value.status === 'not_found').length;
  const kind = session.failure ? 'not_started' : session.timed_out ? 'still_running' : !session.items.length || terminal < session.items.length ? 'generating' : failed ? 'some_failed' : 'all_done';
  const note = session.failure ? session.failure.kind === 'blocked' ? 'blocked' : 'request_failed' : session.timed_out ? 'timed_out' : session.stopped && session.consecutive_errors >= productionProgressFailureLimit ? 'stalled' : session.consecutive_errors ? 'poll_failed' : session.items.some(value => value.media_type === 'video' && !isProductionProgressTerminal(value.status)) ? 'video_hint' : null;
  return {kind, note, terminal, total: session.items.length, failed, stopped: session.stopped};
}
export function validateProductionProgressState() {throw Error('官方制作进度页不保存应用状态；进度只能从真实上游查询');}
export function resolveProductionProgressReply() {throw Error('官方制作进度页不发送对话交接或授权生成');}
