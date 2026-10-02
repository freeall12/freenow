import {inspectModel, disposeModel, maxBytes} from './model-io.mjs';

export function assertSceneBinding(runtime, args, {restoring = false} = {}) {
  runtime.assertReady();
  runtime.assertTargetNode();
  if (args.sessionId !== runtime.sessionId || !Number.isInteger(args.expectedRevision) || args.expectedRevision !== runtime.revision) {
    throw Error('片场会话或版本已改变，请重新读取 scene_read 后重试');
  }
  if (runtime.restoring && !restoring || runtime.motion?.gesture || runtime.transform?.dragging || runtime.capturing) {
    throw Error('正在编辑、恢复或拍摄片场，请完成当前操作后再导入或重做');
  }
}

function validateProperties(properties) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties) ||
      Object.keys(properties).some(key => !['name', 'position', 'rotation', 'scale'].includes(key))) throw Error('导入仅支持名称和三维变换');
  if ('name' in properties && (typeof properties.name !== 'string' || properties.name.length > 120)) throw Error('对象名称无效');
  for (const field of ['position', 'rotation', 'scale']) {
    if (!(field in properties)) continue;
    const value = properties[field];
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite) ||
        field === 'scale' && value.some(n => n < .01 || n > 100)) throw Error('导入变换参数无效');
  }
}

// Model bytes come from an existing local canvas resource, never an invented model URL.
export async function importSceneModel(runtime, args, {signal} = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !['sourceNodeId', 'sessionId', 'expectedRevision', 'sceneIndex', 'properties'].includes(key)) ||
      typeof args.sourceNodeId !== 'string' || !args.sourceNodeId.trim() ||
      args.sceneIndex !== undefined && (!Number.isInteger(args.sceneIndex) || args.sceneIndex < 0)) throw Error('模型导入参数无效');
  const properties = args.properties ?? {};
  validateProperties(properties);
  assertSceneBinding(runtime, args);
  const app = window.CanvasApp, getNode = () => app.getState().nodes.find(node => node.id === args.sourceNodeId), node = getNode();
  if (node?.type !== 'world' || node.worldResource?.format !== 'glb' || typeof node.worldResource.url !== 'string') throw Error('请指定含真实本地 GLB 的 3D 资源节点');
  const source = structuredClone(node.worldResource), sourceKey = JSON.stringify(source);
  if (!source.url.startsWith('asset:')) {
    const url = new URL(source.url, location.href);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw Error('请先将模型导入本地画布资源，不能直接导入外部地址');
  }
  const guard = () => {
    if (signal?.aborted) throw new DOMException('模型导入已取消', 'AbortError');
    assertSceneBinding(runtime, args);
    if (getNode() !== node || JSON.stringify(node.worldResource) !== sourceKey) throw Error('来源模型或目标片场已改变，本次未导入');
  };
  let prepared, adopted = false;
  try {
    guard();
    const resolved = await window.LocalAssets.url(source.url);
    guard();
    const response = await fetch(resolved, {signal});
    if (!response.ok) throw Error('本地模型读取失败');
    const blob = await response.blob();
    guard();
    if (blob.size > maxBytes) throw Error('模型超过 12 MiB，请精简后重试');
    prepared = await inspectModel(new File([blob], 'scene.glb', {type: 'model/gltf-binary'}));
    guard();
    const sceneIndex = args.sceneIndex ?? prepared.defaultScene, object = prepared.loaded.scenes[sceneIndex];
    if (!object?.children.length) throw Error('所选场景没有可导入的节点');
    // Repeated imports are independent objects; saved Studio IDs must not collide.
    object.traverse(value => { delete value.userData.studioId; });
    // Preserve source identity in the actual document and export alongside the model.
    object.userData.studioImport = {sourceNodeId: node.id, sourceAsset: source.url, sceneIndex};
    let result;
    try { result = await runtime.addObject(object, properties, prepared.loaded.animations, {beforeApply: guard}); }
    catch (error) {
      if (object.parent === runtime.content) {
        adopted = true;
        Object.assign(error, {applied: true, entityId: object.userData.studioId, sourceNodeId: node.id, revision: runtime.revision, sessionId: runtime.sessionId});
      }
      throw error;
    }
    adopted = true;
    return {...result, applied: true, version: 2, nodeId: runtime.nodeId, sessionId: runtime.sessionId,
      revision: runtime.revision, savedRevision: runtime.savedRevision, sourceNodeId: node.id, sourceAsset: source.url, sceneIndex};
  } finally {
    for (const scene of prepared?.loaded.scenes || []) if (!adopted || !scene.parent) disposeModel(scene, {retain: runtime.content});
  }
}

export async function redoScene(runtime, args, {signal} = {}) {
  if (!args || Object.keys(args).some(key => !['sessionId', 'expectedRevision'].includes(key))) throw Error('重做参数无效');
  const guard = (restoring = false) => {
    if (signal?.aborted) throw new DOMException('重做已取消', 'AbortError');
    assertSceneBinding(runtime, args, {restoring});
  };
  guard();
  await runtime.undo(true, {beforeApply: () => guard(true)});
  const applied = runtime.revision !== args.expectedRevision;
  try { await runtime.flush(); }
  catch (error) { if (applied) Object.assign(error, {applied: true, revision: runtime.revision, sessionId: runtime.sessionId}); throw error; }
  return {applied, version: 2, nodeId: runtime.nodeId, sessionId: runtime.sessionId,
    revision: runtime.revision, savedRevision: runtime.savedRevision,
    history: {canUndo: runtime.undoStack.length > 0, canRedo: runtime.redoStack.length > 0}};
}
