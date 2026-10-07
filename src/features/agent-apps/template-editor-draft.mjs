const prefix = 'freenow-template-editor-draft-v1:';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const limit = 60000;

/** Tab-local recovery stores text only. It cannot write an artifact or execute HTML. */
export function createTemplateEditorDraft({file, storage, pageScope = ''}) {
  const binding = canonical({scope: file.draft_scope || pageScope, artifact_path: file.artifact_path,
    identity: file.template_source_identity || null, source_artifact_path: file.source_artifact_path || null,
    source_revision: file.source_revision ?? null});
  const key = prefix + encodeURIComponent(JSON.stringify(binding));
  let raw, invalid = false;
  const currentRaw = () => {
    if (!storage) throw Error('当前浏览器未提供会话草稿存储');
    return storage.getItem(key);
  };
  function load(current = file) {
    raw = currentRaw();
    if (raw === null) return null;
    let value;
    try { value = JSON.parse(raw); } catch { invalid = true; throw Error('本地草稿格式损坏；原记录已保留'); }
    if (value?.version !== 1 || JSON.stringify(value.binding) !== JSON.stringify(binding)
      || !Number.isSafeInteger(value.base_revision) || typeof value.base_content !== 'string'
      || typeof value.content !== 'string' || value.content.length > limit || value.base_content.length > limit) {
      invalid = true; throw Error('本地草稿来源或容量无效；原记录已保留');
    }
    invalid = false;
    return {...value, conflict: value.base_revision !== current.revision || value.base_content !== current.content};
  }
  function compare() {
    if (raw === undefined) load();
    if (invalid) throw Error('本地草稿未通过读取校验；原记录已保留');
    if (currentRaw() !== raw) throw Error('同一模板的本地草稿已变化；已有记录和当前输入均保留，请重新打开核对');
  }
  function save(content, base = file) {
    if (typeof content !== 'string' || content.length > limit || base.content.length > limit)
      throw Error('草稿超过本地容量；当前输入仍保留');
    compare();
    const next = JSON.stringify({version: 1, binding, base_revision: base.revision, base_content: base.content, content});
    storage.setItem(key, next); raw = next;
  }
  function clear() { compare(); storage.removeItem(key); raw = null; }
  return {load, save, clear};
}
