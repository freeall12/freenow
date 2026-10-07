const pending = new WeakMap();
const frozenPages = new WeakMap();

// The desktop asks only for storage acknowledgement. Existing app close and
// navigation guards retain unresolved handoffs and reject uncommitted edits.
export function prepareDesktopClose(target = globalThis.window, {keepInputFrozen = false} = {}) {
  if (!target || typeof target !== 'object') return Promise.reject(Error('画布页面尚未就绪，请稍后重试。'));
  if (pending.has(target)) return pending.get(target);
  const work = Promise.resolve().then(async () => {
    const {document, CanvasApp, CanvasStore, CanvasProjects, AgentUI, CanvasTextUI, CanvasLibrary} = target;
    if (!document?.body || typeof CanvasApp?.saveProject !== 'function' || typeof CanvasStore?.flush !== 'function' || typeof CanvasProjects?.prepareNavigation !== 'function' || typeof AgentUI?.close !== 'function') {
      throw Error('画布与会话仍在加载，请稍后关闭。');
    }
    if (target.CanvasImageEditor?.current) throw Error('请先保存并关闭图片编辑器，再关闭画布。');
    if (document.querySelector('.voice-control,.voice-recovery,#skill-manager .manager-form')) throw Error('请先完成或取消当前语音输入或技能编辑，再关闭画布。');
    const body = document.body, wasInert = body.inert === true, focused = document.activeElement;
    const panelWasOpen = !!document.querySelector('#agent-panel');
    const studio = target.StudioAPI, scene = studio?.active;
    const sceneNode = scene && CanvasApp.getState?.().nodes.find(node => node.id === scene.nodeId);
    const projectId = CanvasProjects.id?.();
    let sceneClosed = false, succeeded = false;
    body.inert = true;
    try {
      focused?.blur?.();
      CanvasTextUI?.flush?.();
      if (CanvasTextUI?.hasPendingEdits && CanvasApp.getState?.().nodes.some(node => CanvasTextUI.hasPendingEdits(node.id))) {
        throw Error('文本编辑存在未保存修改或版本冲突，请保留本页处理。');
      }
      await CanvasApp.saveProject();
      await CanvasLibrary?.flush?.();
      // close() returns false after its own error notice; a resolved promise
      // alone must never authorize destruction of the iframe's last edits.
      if (await AgentUI.close() !== true) throw Error('Agent 最后编辑或上下文交接尚未保存，请保留本页并重试。');
      if (scene) {
        if (target.StudioAPI !== studio || studio.active !== scene) throw Error('片场已切换，请保留本页并重新关闭。');
        // The scene owns edit/export guards and the GLB transaction. Await its
        // normal close path after the Agent has flushed its final scene edits.
        await scene.close();
        if (studio.active) throw Error('片场尚未完成关闭，请保留本页并重试。');
        sceneClosed = true;
      }
      await CanvasProjects.prepareNavigation();
      await CanvasStore.flush();
      succeeded = true;
      if (keepInputFrozen) frozenPages.set(target, {wasInert, focused});
      return true;
    } catch (error) {
      // A later storage guard can fail after GPU disposal. Reopen only the
      // same saved node in the same project, never a replacement or new scene.
      if (sceneClosed && target.StudioAPI === studio && !studio.active && sceneNode &&
          CanvasProjects.id?.() === projectId &&
          CanvasApp.getState?.().nodes.find(node => node.id === scene.nodeId) === sceneNode) {
        try {
          await studio.open(scene.nodeId);
        } catch (restoreError) {
          error = new Error(`${error.message}；片场恢复失败：${restoreError.message}，请从画布重新打开已保存片场。`, {cause: error});
        }
      }
      if (panelWasOpen && !document.querySelector('#agent-panel')) AgentUI.open?.();
      throw error;
    } finally {
      if (!succeeded || !keepInputFrozen) {
        body.inert = wasInert;
        if (!wasInert && focused?.isConnected) focused.focus?.({preventScroll: true});
      }
    }
  }).finally(() => { if (pending.get(target) === work) pending.delete(target); });
  pending.set(target, work);
  return work;
}

export function resumeDesktopPage(target = globalThis.window) {
  const previous = frozenPages.get(target);
  if (!previous) return;
  frozenPages.delete(target);
  if (target.document?.body) target.document.body.inert = previous.wasInert;
  if (!previous.wasInert && previous.focused?.isConnected) previous.focused.focus?.({preventScroll: true});
}
