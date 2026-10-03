import {isVerifiedTemplateSource,readVerifiedTemplateSource,validateTemplateIdentity} from '../agent-apps/template-source.mjs';
export const types = ['text', 'markdown', 'csv', 'html', 'image'];
export function validatePath(path) {
  if (typeof path !== 'string' || path.length > 240 || !path.startsWith('artifacts/') || /[\\\x00-\x1f\x7f?#:%]/u.test(path) || path.split('/').some(part => !part.trim() || part === '.' || part === '..')) throw Error('产物路径必须位于 artifacts/，不能包含路径跳转或 URL');
  return path;
}
export const basename = path => path.split('/').at(-1);
export const label = file => file.title || (file.artifact_path === 'artifacts/brainstorm.md' ? 'Brainstorm' : basename(file.artifact_path));
export const primary = file => file.artifact_path === 'artifacts/brainstorm.md' || file.content_type === 'html';
export function ordered(files) {
  return [...files].sort((a, b) => Number(b.artifact_path === 'artifacts/brainstorm.md') - Number(a.artifact_path === 'artifacts/brainstorm.md') || Number(primary(b)) - Number(primary(a)) || b.revision - a.revision);
}
export function metadata({ content, template_source_bytes, ...file }) { return { ...file, length: content.length, ...(template_source_bytes?{source_byte_length:template_source_bytes.length}: {}) }; }
export function nextDocument(document, input, now = new Date().toISOString()) {
  if (Object.keys(input).some(key=>key.startsWith('template_source_'))) throw Error('原模板来源仅能由本地验证导入创建');
  validatePath(input.artifact_path);
  if (input.source_artifact_path !== undefined) validatePath(input.source_artifact_path);
  if (input.source_revision !== undefined && (!Number.isSafeInteger(input.source_revision) || input.source_revision < 1)) throw Error('产物来源版本无效');
  if (!types.includes(input.content_type) || typeof input.content !== 'string' || input.content.length > 60000 || typeof input.title !== 'string' || input.title.length > 200 || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) throw Error('产物字段无效或内容过长');
  const previous = document.files.find(file => file.artifact_path === input.artifact_path);
  if (previous?.template_source_immutable) throw Error('原模板为只读来源，请修改其可编辑产物');
  if (previous?.template_source_identity && input.content_type !== 'html') throw Error('已验证模板编辑产物必须保持 HTML 类型');
  if (previous?.template_source_identity && (input.source_artifact_path !== undefined && input.source_artifact_path !== previous.source_artifact_path || input.source_revision !== undefined && input.source_revision !== previous.source_revision)) throw Error('已验证模板来源不可替换');
  const requestedSource=document.files.find(item=>item.artifact_path===input.source_artifact_path);
  if (!previous?.template_source_identity && requestedSource?.template_source_immutable) throw Error('模型不能创建或冒用已验证模板来源');
  if ((previous?.revision || 0) !== input.expected_revision) throw Error('产物已更新，请重新读取后修改');
  if (!previous && document.files.length >= 200) throw Error('当前画布最多保存 200 个产物');
  const file = { artifact_path: input.artifact_path, title: input.title.trim(), content_type: input.content_type, content: input.content, revision: document.revision + 1, updated_at: now, created_at: previous?.created_at || now };
  if (input.source_artifact_path || previous?.source_artifact_path) file.source_artifact_path = input.source_artifact_path || previous.source_artifact_path;
  if (input.source_revision || previous?.source_revision) file.source_revision = input.source_revision || previous.source_revision;
  if (previous?.template_source_identity) file.template_source_identity = previous.template_source_identity;
  const files = document.files.filter(item => item.artifact_path !== file.artifact_path).concat(file);
  if (files.reduce((sum, item) => sum + item.content.length, 0) > 2000000) throw Error('产物存储容量已达上限');
  return { revision: file.revision, files };
}
/** Host-only import capability is issued after registered identity and byte hash
 * verification. Source and editable copy are created in one store transaction. */
export function nextTemplateImport(document,{source,source_path,artifact_path,title},now=new Date().toISOString()){
  if(!isVerifiedTemplateSource(source))throw Error('原模板尚未经过原始字节验证');
  source=readVerifiedTemplateSource(source);
  validatePath(source_path);validatePath(artifact_path);if(source_path===artifact_path)throw Error('原模板与编辑产物必须使用不同路径');
  const identity=validateTemplateIdentity(source.identity),existingSource=document.files.find(file=>file.artifact_path===source_path),existing=document.files.find(file=>file.artifact_path===artifact_path);
  if(existingSource||existing){
    if(!existingSource?.template_source_immutable||!existing||JSON.stringify(existingSource.template_source_identity)!==JSON.stringify(identity)||JSON.stringify(existing.template_source_identity)!==JSON.stringify(identity)||existing.source_artifact_path!==source_path||existing.source_revision!==existingSource.revision||existingSource.content!==source.content||!(existingSource.template_source_bytes instanceof Uint8Array)||existingSource.template_source_bytes.length!==source.bytes.length||source.bytes.some((byte,index)=>existingSource.template_source_bytes[index]!==byte))throw Error('已有产物与本次模板来源冲突');
    return document;
  }
  let next=nextDocument(document,{artifact_path:source_path,title:title+' · 原模板',content_type:'html',content:source.content,expected_revision:0},now);
  const original=next.files.find(file=>file.artifact_path===source_path);
  Object.assign(original,{template_source_identity:identity,template_source_immutable:true,template_source_bytes:source.bytes.slice()});
  // Create the editable copy through the ordinary limits/revision checks, then
  // attach the host-owned source link. Ordinary write cannot mint this identity.
  next=nextDocument(next,{artifact_path,title,content_type:'html',content:source.content,expected_revision:0},now);
  Object.assign(next.files.find(file=>file.artifact_path===artifact_path),{template_source_identity:identity,source_artifact_path:source_path,source_revision:original.revision});
  return next;
}
export function readSlice(file, offset = 0, limit = 8000) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) throw Error('读取范围无效');
  const end = Math.min(file.content.length, offset + limit);
  return { ...metadata(file), content: file.content.slice(offset, end), offset, next_offset: end < file.content.length ? end : null };
}
