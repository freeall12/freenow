// GLTFLoader may reject one dependency while other geometry/texture promises
// still finish. Track only this loader instance and release those late resources.
export function modelResourceLifecycle() {
  const resources = new Set(), disposed = new WeakSet(); let failed = false, transferred = false;
  function dispose(value) {if (disposed.has(value)) return; disposed.add(value); value.dispose();}
  function collect(value) {
    if (!value || transferred) return;
    if (Array.isArray(value)) {value.forEach(collect); return;}
    if (value.isObject3D) {value.traverse(object => {collect(object.geometry); collect(object.material);}); return;}
    if (value.isMaterial) for (const item of Object.values(value)) if (item?.isTexture) collect(item);
    if (value.isBufferGeometry || value.isMaterial || value.isTexture) {
      if (failed) dispose(value); else resources.add(value);
    }
  }
  return {
    plugin(parser) {
      // These parser methods are the existing Three dependency boundary. No
      // decoder or third-party implementation is replaced or globally patched.
      for (const key of ['getDependency', 'loadGeometries']) {
        const original = parser[key];
        parser[key] = function (...args) {
          const result = original.apply(this, args);
          Promise.resolve(result).then(collect, () => {});
          return result;
        };
      }
      return {name: 'studio_resource_lifecycle'};
    },
    transfer() {transferred = true; resources.clear();},
    fail() {failed = true; for (const resource of resources) dispose(resource); resources.clear();}
  };
}
