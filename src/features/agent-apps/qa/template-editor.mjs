import {createStore} from '../../agent-artifacts/store.mjs';
import {metadata} from '../../agent-artifacts/model.mjs';
import {openTemplateSourceEditor} from '../template-source-editor.mjs';
import {createTemplateQaChatStore} from './template-source-chat-store.mjs';

// UI-only synthetic fixture. Ordinary HTML writes use a separate real IndexedDB;
// no official identity, importTemplate, digest override or template verification bypass.
const $ = id => document.getElementById(id);
const namespace = 'tapnow-template-editor-ui-qa-v1';
const artifactPath = 'artifacts/qa/synthetic-editor.html';
const store = createStore({namespace});
const eventStore = createTemplateQaChatStore({name: 'tapnow-template-editor-ui-qa-events-v1', label: '合成编辑器UI验收'});
let events = (await eventStore.load())?.events ?? [];
let failSave = false, invalid = false, sourceEpoch = 0, editor = null, leaving = false, recordWork = Promise.resolve();

async function report(extra) {
  const file = await store.get(artifactPath);
  const storedEvents = (await eventStore.load())?.events ?? [];
  $('receipt').textContent = JSON.stringify({
    label: '合成编辑器 UI 验收，不是官方模板导入',
    namespace, artifact_path: artifactPath, source_identity: null,
    controls: {failSave, invalid, sourceEpoch},
    actual_readback: {...metadata(file), content: file.content},
    persisted_events: storedEvents,
    extra,
  }, null, 2);
}

function record(type, extra = {}) {
  const next = recordWork.catch(() => {}).then(async () => {
    events = [...events.slice(-29), {type, at: new Date().toISOString(), ...extra}];
    if (await eventStore.save({events}) === false) throw Error('验收记录保存未提交');
    await report();
  });
  recordWork = next;
  return next;
}

function setFailure(value) { failSave = value; $('fail').checked = value; void report('保存失败开关已更新'); }
function setInvalid(value) { invalid = value; sourceEpoch++; $('invalid').checked = value; void report('来源版本已变化；当前编辑会话不能恢复，请重新打开'); }

async function createSyntheticSession() {
  const boundEpoch = sourceEpoch;
  let closed = false, saving = false, current = await store.get(artifactPath);
  const guard = () => {
    if (closed) throw Error('合成编辑会话已关闭');
    if (leaving || invalid || sourceEpoch !== boundEpoch) throw Error('合成编辑来源已失效；请保留草稿并重新打开编辑器');
    return true;
  };
  guard();
  return {
    read() { guard(); return {...metadata(current), content: current.content}; },
    async save({content, title = current.title}) {
      guard(); if (saving) throw Error('合成正文正在保存'); saving = true;
      let committed = false;
      try {
        if (failSave) throw Error('合成编辑器验收：模拟保存失败，正文未写入');
        const latest = await store.get(artifactPath); guard();
        if (latest.revision !== current.revision) throw Error('自由 HTML 已更新，请保留草稿并重新打开最新版本');
        const saved = await store.write({artifact_path: artifactPath, title, content_type: 'html', content, expected_revision: current.revision}, {guard});
        committed = true; current = {...current, ...saved, content}; guard();
        return {...metadata(current), content: current.content};
      } catch (error) {
        if (committed) throw Error('合成 HTML 已实际保存，但编辑来源随后失效：' + error.message);
        throw error;
      } finally { saving = false; }
    },
    close() { if (!closed) { closed = true; void record('editor-closed', {revision: current.revision}); } },
    isCurrent() { try { return guard(); } catch { return false; } },
  };
}

function addQaControls(dialog) {
  dialog.dataset.templateEditorQa = '';
  const aside = dialog.querySelector('aside');
  const note = document.createElement('p'); note.className = 'template-editor-qa-note';
  note.textContent = '合成编辑器 UI 验收，不是官方模板导入。当前内容是普通自由 HTML，没有官方原模板或来源身份。';
  const switches = document.createElement('div'); switches.className = 'template-editor-qa-switches';
  for (const [id, text, checked, change] of [
    ['dialog-fail', '保存失败', failSave, setFailure],
    ['dialog-invalid', '让当前来源失效', invalid, setInvalid],
  ]) {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.checked = checked; input.onchange = () => change(input.checked); label.append(input, document.createTextNode(text)); switches.append(label);
  }
  aside.insertBefore(note, aside.querySelector('.agent-html-disclaimer'));
  aside.insertBefore(switches, aside.querySelector('.agent-html-actions'));
}

$('open').onclick = async () => {
  if (editor?.element.isConnected) return;
  let session;
  try {
    session = await createSyntheticSession();
    await record('editor-opened', {revision: session.read().revision});
    editor = openTemplateSourceEditor({session, onSaved: async file => {
      const actual = await store.get(artifactPath);
      if (actual.revision !== file.revision || actual.content !== file.content) throw Error('实际回读与保存结果不一致');
      await record('save-readback-confirmed', {revision: actual.revision, content: actual.content});
    }, onError: message => { void record('editor-error', {message}); }});
    addQaControls(editor.element);
  } catch (error) { session?.close(); await record('open-error', {message: error.message}); }
};
$('read').onclick = () => record('manual-readback');
$('reload').onclick = () => location.reload();
$('fail').onchange = () => setFailure($('fail').checked);
$('invalid').onchange = () => setInvalid($('invalid').checked);
window.addEventListener('pagehide', () => { leaving = true; eventStore.close(); });

if (!(await store.list()).some(file => file.artifact_path === artifactPath)) {
  await store.write({artifact_path: artifactPath, title: '合成编辑器UI验收 · 自由HTML', content_type: 'html', content: '<!doctype html>\n<html lang="zh-CN"><meta charset="utf-8"><body><h1>合成编辑器 UI 验收</h1><p>普通自由 HTML，不是官方模板正文。</p></body></html>', expected_revision: 0});
}
await record('page-loaded', {revision: (await store.get(artifactPath)).revision});
