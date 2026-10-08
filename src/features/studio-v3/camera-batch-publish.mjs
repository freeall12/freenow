import {assertJson, clone, isRecord, same} from './invariants.mjs';

const fail = (code, message) => Object.assign(new Error(message), {code});
const stableFence = fence => {const {revision, editEpoch, ...identity} = fence; return identity;};
const localAsset = value => typeof value === 'string' && value.startsWith('asset:') && value.length > 6;
const errorSummary = (shotId, error) => ({shotId, message: error?.message || String(error),
  ...(typeof error?.code === 'string' ? {code: error.code} : {})});

/** Owns one rendered batch until its connected media have been durably saved.
 * Renderer and local assets are adapters; no generation/provider calls. */
export function createCameraBatchPublish({app, session, nodeId, renderer, isCurrent = session?.isCurrent,
  getFence = session?.getFence, assets = globalThis.window?.LocalAssets, onStatus = () => {},
  createId = () => crypto.randomUUID(), now = Date.now} = {}) {
  for (const [name, method] of Object.entries({getState: app?.getState, createConnected: app?.createConnected,
    saveProject: app?.saveProject, flush: session?.flush, read: session?.getState, render: renderer?.render,
    put: assets?.put, isCurrent, getFence, onStatus, createId, now})) {
    if (typeof method !== 'function') throw new TypeError(`cameraBatchPublish.${name} requires a callback`);
  }
  if (typeof nodeId !== 'string' || !nodeId) throw new TypeError('cameraBatchPublish.nodeId requires an owner');
  let busy = false, disposed = false, receipt = null, controller = null;
  const nodes = () => app.getState().nodes;
  const find = id => nodes().find(node => node.id === id);
  const publicReceipt = () => receipt ? {exportId: receipt.exportId, shotIds: [...receipt.shotIds],
    nodeIds: receipt.items.map(item => item.nodeId).filter(Boolean), applied: receipt.items.some(item => !!item.nodeId)} : null;
  const counts = () => ({successCount: receipt?.successCount ?? 0, errorCount: receipt?.errors.length ?? 0,
    itemCount: receipt?.items.length ?? 0});
  function emit(status, detail = {}) {
    try {onStatus({status, busy, ...publicReceipt(), ...counts(), ...detail});} catch {}
  }
  function ready() {
    if (disposed || !isCurrent() || session.isCurrent?.() === false || !find(nodeId)) {
      throw fail('studio_v3_batch_stale', '片场所有权或来源已变化，本次导出停止');
    }
    if (session.history?.getActiveTransaction?.()) throw fail('studio_v3_batch_transaction', '请先完成当前片场编辑，再导出镜头');
  }
  function context() {
    ready(); const fence = getFence(), state = session.getState();
    assertJson(fence, 'cameraBatch.fence'); assertJson(state, 'cameraBatch.state');
    if (!isRecord(fence) || !state?.scenePlay?.worldSpace) throw fail('studio_v3_batch_context', '片场导出上下文无效');
    const owner = find(nodeId), sourceId = fence.sourceBinding?.sourceNodeId;
    const identity = typeof app.projectIdentity === 'function' ? app.projectIdentity() : fence.projectId;
    const project = typeof identity === 'string' ? identity : identity?.id;
    if (typeof project !== 'string' || !project.trim()) throw fail('studio_v3_batch_project', '画布项目标识无效，镜头未继续写入');
    return {owner, sourceId, sourceOwner: sourceId ? find(sourceId) : null, fence: clone(fence), state: clone(state),
      ownerSnapshot: owner.studioV3 ? clone(owner.studioV3) : null,
      // Project metadata changes during normal saves; only its ID owns this batch.
      project};
  }
  function check(record, beforeFlush = false) {
    ready(); const current = context();
    if (current.owner !== record.owner || current.sourceOwner !== record.sourceOwner ||
      !same(current.project, record.project) || !same(current.state, record.state) ||
      !same(beforeFlush ? stableFence(current.fence) : current.fence, beforeFlush ? stableFence(record.fence) : record.fence) ||
      !beforeFlush && !same(current.ownerSnapshot, record.ownerSnapshot)) {
      throw fail('studio_v3_batch_stale', '来源、状态或片场内容已变化，本批镜头未继续写入');
    }
    for (const item of record.items || []) {
      if (!item.nodeId) continue;
      const node = find(item.nodeId), media = item.type === 'image' ? node?.image : node?.video;
      if (!node || node.type !== item.type || media !== item.asset || node.pixelWidth !== item.width ||
        node.pixelHeight !== item.height || !same(node.provenance, item.provenance) || node.duration !== item.duration ||
        item.type === 'video' && node.image !== (item.posterAsset ?? undefined)) {
        throw fail('studio_v3_batch_receipt_stale', '导出的媒体已删除或修改，不能重复创建或覆盖');
      }
    }
    return true;
  }
  function readShots(shots) {
    assertJson(shots, 'cameraBatch.shots');
    if (!Array.isArray(shots) || !shots.length || shots.some(shot => !isRecord(shot) || typeof shot.id !== 'string' || !shot.id) ||
      new Set(shots.map(shot => shot.id)).size !== shots.length) {
      throw fail('studio_v3_batch_shots', '请选择至少一个具有唯一标识的镜头');
    }
    return clone(shots);
  }
  function readItem(output, shot, index) {
    if (!isRecord(output) || !['image', 'video'].includes(output.type) || !(output.blob instanceof Blob) || !output.blob.size ||
      !output.blob.type.startsWith(output.type + '/') || !Number.isSafeInteger(output.width) || output.width < 1 ||
      !Number.isSafeInteger(output.height) || output.height < 1 || output.title !== undefined && typeof output.title !== 'string' ||
      output.duration !== undefined && (!Number.isFinite(output.duration) || output.duration <= 0) ||
      output.posterBlob !== undefined && (!(output.posterBlob instanceof Blob) || !output.posterBlob.size || !output.posterBlob.type.startsWith('image/'))) {
      throw fail('studio_v3_batch_media', `镜头“${shot.title || shot.id}”未产出有效媒体`);
    }
    const extra = output.provenance ?? {};
    assertJson(extra, 'cameraBatch.provenance');
    if (!isRecord(extra)) throw fail('studio_v3_batch_media', '媒体溯源必须是 JSON 对象');
    const itemId = `${receipt.exportId}:${receipt.items.length + index}`;
    const space = receipt.state.scenePlay.worldSpace;
    // Blob references stay outside JSON metadata and survive storage retries.
    return {type: output.type, blob: output.blob, posterBlob: output.posterBlob, width: output.width, height: output.height,
      title: output.title ?? shot.title ?? '片场镜头导出', duration: output.duration, asset: null, posterAsset: null, nodeId: null,
      provenance: {...clone(extra), kind: 'studio-shot-export', sceneId: nodeId, sceneVersion: 3,
        batchExportId: receipt.exportId, itemId, shotId: shot.id, stageId: space.activeStageId, setupId: space.activeSetupId,
        sourceNodeId: receipt.fence.sourceBinding?.sourceNodeId ?? nodeId, revision: receipt.fence.revision ?? 0,
        createdAt: receipt.createdAt}};
  }
  async function prepare(shots, initial) {
    check(initial, true);
    const saved = await session.flush(); check(initial, true);
    if (!saved?.ok || saved.readonly || session.getStatus?.().dirty) throw fail('studio_v3_batch_scene_save', '片场尚未保存，镜头未导出');
    const baseline = context(), exportId = createId(), createdAt = now();
    if (typeof exportId !== 'string' || !exportId || !Number.isFinite(createdAt) || createdAt < 0) {
      throw fail('studio_v3_batch_identity', '导出标识或时间无效');
    }
    const space = baseline.state.scenePlay.worldSpace;
    if (shots.some(shot => shot.stageId !== undefined && shot.stageId !== space.activeStageId ||
      shot.setupId !== undefined && shot.setupId !== space.activeSetupId)) throw fail('studio_v3_batch_shots', '镜头不属于当前场景状态');
    receipt = {...baseline, exportId, createdAt, shots, shotIds: shots.map(shot => shot.id), items: [], errors: [], successCount: 0, renderedComplete: false};
    for (const shot of shots) {
      emit('rendering', {shotId: shot.id}); check(receipt);
      let outputs;
      try {outputs = await renderer.render(clone(shot), {state: clone(receipt.state), signal: controller.signal});}
      catch (error) {check(receipt); receipt.errors.push(errorSummary(shot.id, error)); emit('shot-failed', {shotId: shot.id}); check(receipt); continue;}
      check(receipt);
      let rendered = false;
      try {
        if (!Array.isArray(outputs) || !outputs.length) throw fail('studio_v3_batch_media', '镜头渲染未返回媒体');
        const items = outputs.map((output, index) => readItem(output, shot, index));
        receipt.items.push(...items); receipt.successCount++; rendered = true;
      } catch (error) {receipt.errors.push(errorSummary(shot.id, error));}
      emit(rendered ? 'shot-rendered' : 'shot-failed', {shotId: shot.id}); check(receipt);
    }
    if (!receipt.items.length) {
      const errors = clone(receipt.errors); receipt = null;
      throw Object.assign(fail('studio_v3_batch_no_results', '所有镜头均未成功导出：' + errors.map(error => error.message).join('；')), {errors});
    }
    receipt.renderedComplete = true;
  }
  function recover() {
    for (const item of receipt.items) {
      const matches = nodes().filter(node => node.provenance?.batchExportId === receipt.exportId && node.provenance?.itemId === item.provenance.itemId);
      if (matches.length > 1) throw fail('studio_v3_batch_receipt_stale', '导出回执对应多个媒体节点，不能重复写入');
      if (matches.length === 1 && !item.nodeId) item.nodeId = matches[0].id;
    }
  }
  function output(item) {
    return {type: item.type, title: item.title, width: item.width, height: item.height, pixelWidth: item.width, pixelHeight: item.height,
      ...(item.type === 'image' ? {image: item.asset} : {video: item.asset,
        ...(item.posterAsset ? {image: item.posterAsset} : {})}),
      ...(item.duration !== undefined ? {duration: item.duration} : {}),
      provenance: clone(item.provenance), createdAt: new Date(receipt.createdAt).toISOString()};
  }
  async function publish() {
    check(receipt);
    for (const item of receipt.items) {
      if (!item.asset) {
        emit('saving-asset', {itemId: item.provenance.itemId}); check(receipt);
        const asset = await assets.put(item.blob);
        if (!localAsset(asset)) {check(receipt); throw fail('studio_v3_batch_asset', '媒体未保存为本地素材');}
        item.asset = asset; check(receipt);
      }
      if (item.posterBlob && !item.posterAsset) {
        emit('saving-poster', {itemId: item.provenance.itemId}); check(receipt);
        const asset = await assets.put(item.posterBlob);
        if (!localAsset(asset)) {check(receipt); throw fail('studio_v3_batch_asset', '视频封面未保存为本地素材');}
        item.posterAsset = asset; check(receipt);
      }
    }
    recover(); check(receipt);
    const missing = receipt.items.filter(item => !item.nodeId);
    if (missing.length) {
      emit('adding-to-canvas'); check(receipt);
      try {app.createConnected(nodeId, missing.map(output));}
      catch (error) {recover(); throw error;}
      recover(); check(receipt);
      if (receipt.items.some(item => !item.nodeId)) throw fail('studio_v3_batch_node', '画布未创建全部导出媒体');
    }
    emit('saving-canvas'); check(receipt);
    await app.saveProject({beforeCommit: () => {try {return check(receipt);} catch {return false;}}}); check(receipt);
    const result = {ok: true, ...publicReceipt(), ...counts(), errors: clone(receipt.errors), items: receipt.items.map(item =>
      ({nodeId: item.nodeId, asset: item.asset, ...(item.posterAsset ? {posterAsset: item.posterAsset} : {}), ...output(item)}))};
    receipt = null; emit('saved', result); return result;
  }
  return Object.freeze({
    async export(shots) {
      if (busy) throw Object.assign(fail('studio_v3_batch_busy', '镜头正在导出，请等待完成'), {applied: !!publicReceipt()?.applied, pending: !!receipt, retryable: false});
      busy = true; controller = new AbortController();
      try {
        if (receipt) {
          check(receipt);
          if (!receipt.renderedComplete) throw fail('studio_v3_batch_incomplete', '镜头渲染已失效，请关闭失效会话后重新导出');
          if (shots !== undefined && !same(readShots(shots).map(shot => shot.id), receipt.shotIds)) throw fail('studio_v3_batch_pending', '请先重试保存当前批次，再导出其他镜头');
          emit('retrying'); check(receipt);
        } else {
          const selected = readShots(shots), initial = context(); emit('preparing'); await prepare(selected, initial);
        }
        return await publish();
      } catch (caught) {
        const error = caught instanceof Error ? caught : new Error(String(caught));
        if (disposed) receipt = null;
        let retryable = false;
        if (receipt?.renderedComplete) {try {retryable = check(receipt);} catch {}}
        Object.assign(error, {applied: !!publicReceipt()?.applied, pending: !!receipt, retryable,
          ...(receipt ? {...publicReceipt(), pendingReceipt: publicReceipt(), ...counts(), errors: clone(receipt.errors)} : {})});
        emit('failed', {message: error.message, code: error.code, errors: clone(error.errors ?? receipt?.errors ?? []),
          errorCount: error.errors?.length ?? receipt?.errors.length ?? 0});
        // A status observer can invalidate ownership as it refreshes the host.
        if (error.retryable) {try {check(receipt);} catch {error.retryable = false;}}
        throw error;
      } finally {busy = false; controller = null; if (disposed) receipt = null; emit('idle');}
    },
    dispose() {disposed = true; controller?.abort(); if (!busy) receipt = null;},
    get busy() {return busy;},
    get pendingReceipt() {return publicReceipt();}
  });
}
