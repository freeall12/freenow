import {metadata} from '../agent-artifacts/model.mjs';

const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A host-bound editing session reads the latest editable copy and saves through revision CAS. */
export function createTemplateEditSession({store, artifact, source, sourceIdentity, receiptStatus, guard, onClose = () => {}}) {
  if (!source?.template_source_immutable || artifact?.template_source_immutable || artifact?.content_type !== 'html'
    || !same(source.template_source_identity, sourceIdentity) || !same(artifact.template_source_identity, sourceIdentity)
    || artifact.source_artifact_path !== source.artifact_path || artifact.source_revision !== source.revision) {
    throw Error('编辑产物与已验证原模板来源不一致');
  }
  let current = clone(artifact), closed = false, saving = false;
  function check() {
    if (closed) throw Error('模板编辑会话已关闭');
    if (guard() === false) throw Error('模板编辑来源已变化');
  }
  function read() {
    check();
    return {...metadata(current), content: current.content, receipt_status: receiptStatus, draft_scope: store.namespace};
  }
  async function save({content, title = current.title}) {
    check();
    if (saving) throw Error('模板正文正在保存');
    saving = true;
    let committed = false;
    try {
      const latest = await store.get(current.artifact_path);
      check();
      if (latest.revision !== current.revision) throw Error('产物已更新，请保留当前修改并重新打开最新版本');
      if (!same(latest.template_source_identity, sourceIdentity) || latest.source_artifact_path !== source.artifact_path || latest.source_revision !== source.revision) {
        throw Error('编辑产物来源已变化');
      }
      const input = {artifact_path: current.artifact_path, title, content_type: 'html', content, expected_revision: current.revision};
      const saved = await store.write(input, {guard: check});
      committed = true;
      current = {...current, ...saved, content};
      check();
      return read();
    } catch (error) {
      if (committed) throw Error('HTML 已保存，但编辑来源已变化，未返回编辑成功：' + error.message);
      throw error;
    } finally { saving = false; }
  }
  function close() { if (!closed) { closed = true; onClose(); } }
  check();
  return {read, save, close, isCurrent() { try { check(); return true; } catch { return false; } }};
}
