import * as THREE from 'three';
import {placementSupport} from './surface-hit.mjs';

export function resolveDropPlacement({kind, object, transform, meshes = [], colliders = [], groundY = 0}) {
  if (!['actor', 'prop'].includes(kind) || !object || !transform) return null;
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object, true), position = transform.position;
  const referenceY = box.isEmpty() ? position.y : box.min.y;
  const points = box.isEmpty() ? [{x: position.x, z: position.z}] : [
    {x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2},
    {x: box.min.x, z: box.min.z}, {x: box.min.x, z: box.max.z},
    {x: box.max.x, z: box.min.z}, {x: box.max.x, z: box.max.z}
  ];
  // Exclude an entity's complete root before raycasting; hiding its own mesh
  // would also disturb selection and a concurrent GPU frame.
  const withoutSelf = roots => {
    const candidates = new Set();
    for (const root of roots) root.traverse(candidate => {
      if (!candidate.isMesh) return;
      for (let node = candidate; node; node = node.parent) if (node === object) return;
      candidates.add(candidate);
    });
    return [...candidates];
  };
  const support = placementSupport(points, {meshes: withoutSelf(meshes), colliders: withoutSelf(colliders), groundY, referenceY});
  if (!support) return null;
  const next = structuredClone(transform); next.position.y += support.point.y - referenceY;
  return {transform: next, support, referenceY, points};
}
