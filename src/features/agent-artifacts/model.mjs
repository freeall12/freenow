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
export function metadata({ content, ...file }) { return { ...file, length: content.length }; }
export function nextDocument(document, input, now = new Date().toISOString()) {
  validatePath(input.artifact_path);
  if (input.source_artifact_path !== undefined) validatePath(input.source_artifact_path);
  if (input.source_revision !== undefined && (!Number.isSafeInteger(input.source_revision) || input.source_revision < 1)) throw Error('产物来源版本无效');
  if (!types.includes(input.content_type) || typeof input.content !== 'string' || input.content.length > 60000 || typeof input.title !== 'string' || input.title.length > 200 || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) throw Error('产物字段无效或内容过长');
  const previous = document.files.find(file => file.artifact_path === input.artifact_path);
  if ((previous?.revision || 0) !== input.expected_revision) throw Error('产物已更新，请重新读取后修改');
  if (!previous && document.files.length >= 200) throw Error('当前画布最多保存 200 个产物');
  const file = { artifact_path: input.artifact_path, title: input.title.trim(), content_type: input.content_type, content: input.content, revision: document.revision + 1, updated_at: now, created_at: previous?.created_at || now };
  if (input.source_artifact_path || previous?.source_artifact_path) file.source_artifact_path = input.source_artifact_path || previous.source_artifact_path;
  if (input.source_revision || previous?.source_revision) file.source_revision = input.source_revision || previous.source_revision;
  const files = document.files.filter(item => item.artifact_path !== file.artifact_path).concat(file);
  if (files.reduce((sum, item) => sum + item.content.length, 0) > 2000000) throw Error('产物存储容量已达上限');
  return { revision: file.revision, files };
}
export function readSlice(file, offset = 0, limit = 8000) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) throw Error('读取范围无效');
  const end = Math.min(file.content.length, offset + limit);
  return { ...metadata(file), content: file.content.slice(offset, end), offset, next_offset: end < file.content.length ? end : null };
}
