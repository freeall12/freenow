// Keep submission readiness independent of Three and browser initialization.
// Add formats here only after resource.materialize can decode and persist them.
export function worldRendererCapabilities() {
  return {formats: ['glb','spz'], representations: ['mesh','gaussianSplat'], gaussianSplat: true};
}

export function worldRendererError(resource = {}) {
  const capabilities = worldRendererCapabilities();
  if (resource.format !== undefined && !capabilities.formats.includes(resource.format))
    return '此 3D 结果格式的渲染器尚未接入；当前本地支持 GLB 网格和预算内 SPZ 高斯';
  if (resource.representation !== undefined && !capabilities.representations.includes(resource.representation))
    return '此 3D 表示的本地渲染器尚未接入；当前本地支持 GLB 网格和预算内 SPZ 高斯';
  if(resource.format==='glb'&&resource.representation==='gaussianSplat'||resource.format==='spz'&&resource.representation==='mesh')return '3D 结果格式与表示类型不一致，不能将高斯当作网格应用';
  return null;
}

export function assertWorldRendererSupport(resource) {
  const message = worldRendererError(resource);
  if (message) throw Object.assign(Error(message), {code: 'world_renderer_unavailable'});
}
