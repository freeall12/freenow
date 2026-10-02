import * as THREE from 'three';
// Official fc pivot math, with its parent matrix mirrored outside the exported scene.
export class CenteredTransform {
  constructor(scene){this.anchor=new THREE.Group();this.anchor.matrixAutoUpdate=false;scene.add(this.anchor);this.pivot=new THREE.Object3D();this.anchor.add(this.pivot);this.relative=new THREE.Matrix4();this.matrix=new THREE.Matrix4();}
  attach(target){this.target=null;if(!target?.parent)return false;target.updateWorldMatrix(true,true);this.anchor.matrix.copy(target.parent.matrixWorld);this.anchor.matrixWorldNeedsUpdate=true;const bounds=new THREE.Box3().setFromObject(target),center=bounds.isEmpty()?target.getWorldPosition(new THREE.Vector3()):bounds.getCenter(new THREE.Vector3());this.pivot.position.copy(target.parent.worldToLocal(center));this.pivot.quaternion.copy(target.quaternion);this.pivot.scale.setScalar(1);this.pivot.updateMatrix();this.pivot.updateWorldMatrix(true,false);this.relative.copy(this.pivot.matrix).invert().multiply(target.matrix);this.target=target;return true;}
  apply(){const target=this.target;if(!target)return;this.pivot.updateMatrix();this.matrix.copy(this.pivot.matrix).multiply(this.relative);this.matrix.decompose(target.position,target.quaternion,target.scale);target.updateMatrix();target.updateWorldMatrix(false,true);return target;}
  detach(){this.target=null;}
  dispose(){this.detach();this.anchor.removeFromParent();}
}
