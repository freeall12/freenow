import {validatePath} from '../agent-artifacts/model.mjs';

function argumentsFor(args, keys) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key))) throw Error('展示工具参数无效');
  if (args.title !== undefined && (typeof args.title !== 'string' || args.title.length > 200)) throw Error('展示标题无效');
  return args;
}

// The code remains in trace.args. Preparing metadata does not execute it, prove
// a frame loaded, or grant access to the host's tools and credentials.
export function prepareWidget(args) {
  argumentsFor(args, ['title', 'widget_code']);
  if (typeof args.widget_code !== 'string' || !args.widget_code.trim() || args.widget_code.length > 60000) throw Error('组件代码为空或超过 60000 字符');
  return {kind: 'widget', title: args.title || '互动组件'};
}

// Read the complete local document, never a paged snippet or a remote URL. The
// viewer must check namespace/path/revision again before opening the preview.
export async function prepareHtml(args, {store, namespace} = {}) {
  argumentsFor(args, ['title', 'artifact_path', 'description']);
  validatePath(args.artifact_path);
  if (args.description !== undefined && (typeof args.description !== 'string' || args.description.length > 4000)) throw Error('HTML 描述无效');
  const boundNamespace = namespace ?? store?.namespace;
  if (typeof boundNamespace !== 'string' || !boundNamespace.trim() || !store || typeof store.get !== 'function' || store.namespace !== undefined && store.namespace !== boundNamespace) throw Error('HTML 产物未绑定当前画布存储');
  const file = await store.get(args.artifact_path);
  if (!file || file.artifact_path !== args.artifact_path || file.content_type !== 'html') throw Error('指定产物不是当前画布的 HTML 文件');
  if (typeof file.content !== 'string' || !file.content.trim() || file.content.length > 60000) throw Error('HTML 产物内容为空或无效');
  if (!Number.isSafeInteger(file.revision) || file.revision < 1) throw Error('HTML 产物版本无效');
  return {kind: 'html', namespace: boundNamespace, artifact_path: file.artifact_path, revision: file.revision, title: args.title || 'HTML', ...(args.description !== undefined ? {description: args.description} : {})};
}
