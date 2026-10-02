const updateFields = ['name', 'position', 'rotation', 'scale', 'viewport'];
export const supportedCameraProperties = ['viewport'];
export const supportedLightingProperties = ['azimuth', 'elevation'];

export function validateViewport(viewport) {
  if (viewport === null) return null;
  if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport) ||
      Object.keys(viewport).some(key => !['width', 'height'].includes(key))) throw Error('画幅必须为宽高尺寸或 null');
  const {width, height} = viewport;
  if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192) ||
      width / height < 1 / 20 || width / height > 20) throw Error('画幅宽高必须为 1–8192 整数，比例必须在 1:20 到 20:1 之间');
  return {width, height};
}

export function validateLighting(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length ||
      Object.keys(patch).some(key => !supportedLightingProperties.includes(key))) throw Error('新版片场仅支持光照 azimuth 和 elevation');
  const next = {...current, ...patch};
  if (!Number.isFinite(next.azimuth) || next.azimuth < 0 || next.azimuth > 360 ||
      !Number.isFinite(next.elevation) || next.elevation < -90 || next.elevation > 90) throw Error('光照方位必须为 0–360°，高度必须为 -90–90°');
  return {azimuth: next.azimuth, elevation: next.elevation};
}

export function cameraSettings(runtime) {
  const cameras = [];
  runtime.content.traverse(camera => {
    if (!camera.isCamera) return;
    const id = camera.userData.studioId, viewport = runtime.shotRatios[id];
    const projection = camera.isPerspectiveCamera ? {
      type: 'perspective', fovDegrees: camera.fov, aspect: camera.aspect,
      near: camera.near, far: camera.far, zoom: camera.zoom
    } : {
      type: camera.isOrthographicCamera ? 'orthographic' : 'camera',
      left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom,
      near: camera.near, far: camera.far, zoom: camera.zoom
    };
    const originalAspect = camera.isPerspectiveCamera ? camera.aspect :
      camera.isOrthographicCamera ? (camera.right - camera.left) / (camera.top - camera.bottom) : null;
    cameras.push({id, viewport: viewport ? {...viewport} : null,
      effectiveAspect: viewport ? viewport.width / viewport.height : originalAspect, projection});
  });
  return cameras;
}

function assertEditable(runtime) {
  runtime.assertReady();
  if (runtime.restoring || runtime.motion?.gesture || runtime.transform?.dragging || runtime.capturing) {
    throw Error('正在编辑、恢复或拍摄片场，请完成当前操作后再修改设置');
  }
}

function validateUpdate(runtime, id, patch) {
  const target = runtime.find(id);
  if (!target) throw Error('对象不存在');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length ||
      Object.keys(patch).some(key => !updateFields.includes(key))) throw Error('新版片场仅支持名称、变换和相机画幅');
  if ('name' in patch && (typeof patch.name !== 'string' || patch.name.length > 120)) throw Error('对象名称无效');
  for (const field of ['position', 'rotation', 'scale']) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite) ||
        field === 'scale' && value.some(n => n < .01 || n > 100)) throw Error('对象变换参数无效');
  }
  if (runtime.animatedCamera(target) && ['position', 'rotation', 'scale'].some(field => field in patch)) throw Error('镜头包含运镜，请通过关键帧编辑姿态');
  if ('viewport' in patch) {
    if (!target.isCamera) throw Error('只有相机支持画幅设置');
    validateViewport(patch.viewport);
  }
  return target;
}

async function persist(runtime, changed, details) {
  try { await runtime.flush(); }
  catch (error) { if (changed) Object.assign(error, {applied: true, ...details}); throw error; }
}

// Both Agent and UI use the runtime setters; mixed patches validate before the first mutation.
export async function updateSceneSettings(runtime, id, patch) {
  assertEditable(runtime);
  validateUpdate(runtime, id, patch);
  const {viewport, ...transform} = patch, hasViewport = 'viewport' in patch;
  const revision = runtime.revision;
  if (Object.keys(transform).length) {
    runtime.update(id, transform, {notify: false});
    if (hasViewport) runtime.setShotRatio(viewport, {cameraId: id, history: false, notify: false});
    runtime.commit();
  } else if (hasViewport) runtime.setShotRatio(viewport, {cameraId: id});
  await persist(runtime, runtime.revision !== revision, {entityId: id});
  return {...runtime.objects().find(object => object.id === id),
    ...(runtime.find(id)?.isCamera ? {cameraSettings: cameraSettings(runtime).find(camera => camera.id === id)} : {})};
}

export async function updateSceneEnvironment(runtime, args) {
  assertEditable(runtime);
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !['lighting', 'ground'].includes(key)) || !Object.keys(args).length) throw Error('新版片场环境工具仅支持 lighting 方位和高度、ground.grid');
  const lighting = 'lighting' in args ? validateLighting(runtime.lighting, args.lighting) : {...runtime.lighting};
  if ('ground' in args && (!args.ground || typeof args.ground !== 'object' || Array.isArray(args.ground) ||
      Object.keys(args.ground).length !== 1 || typeof args.ground.grid !== 'boolean')) throw Error('新版片场地面仅支持 ground.grid 布尔开关');
  const grid = args.ground?.grid ?? runtime.grid.visible;
  const changed = grid !== runtime.grid.visible || lighting.azimuth !== runtime.lighting.azimuth || lighting.elevation !== runtime.lighting.elevation;
  if (changed) {
    runtime.recordHistory(runtime.snapshot());
    runtime.setLighting(lighting, {history: false, notify: false});
    runtime.setGrid(grid, {history: false, notify: false});
    runtime.commit();
  }
  await persist(runtime, changed, {settings: 'environment'});
  return {version: 2, nodeId: runtime.nodeId, sessionId: runtime.sessionId, revision: runtime.revision,
    savedRevision: runtime.savedRevision, applied: changed, grid: runtime.grid.visible,
    lighting: {...runtime.lighting}, lightingUnits: 'degrees'};
}
