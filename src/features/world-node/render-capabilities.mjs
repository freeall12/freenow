// Keep submission readiness independent of Three and browser initialization.
// Add formats here only after resource.materialize can decode and persist them.
export function worldRendererCapabilities() {
  return {formats: ['glb'], representations: ['mesh'], gaussianSplat: false};
}

export function worldRendererError(resource = {}) {
  const capabilities = worldRendererCapabilities();
  if (resource.format !== undefined && !capabilities.formats.includes(resource.format))
    return '此 3D 结果格式的渲染器尚未接入；当前本地仅能应用 GLB 网格';
  if (resource.representation !== undefined && !capabilities.representations.includes(resource.representation))
    return resource.representation === 'gaussianSplat'
      ? '当前本地尚未接通高斯泼溅（SPZ）渲染，暂时无法生成并应用此 3D 场景'
      : '此 3D 表示的本地渲染器尚未接入；当前本地仅能应用 GLB 网格';
  return null;
}

export function assertWorldRendererSupport(resource) {
  const message = worldRendererError(resource);
  if (message) throw Object.assign(Error(message), {code: 'world_renderer_unavailable'});
}
