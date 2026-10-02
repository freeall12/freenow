import * as THREE from 'three';
export const patchPlaneDistance=10,minimumPatchSpan=.5;
export const cropHandles=['tl','t','tr','r','br','b','bl','l'];
export const cropCursors={tl:'nesw-resize',tr:'nwse-resize',bl:'nwse-resize',br:'nesw-resize',t:'ns-resize',b:'ns-resize',l:'ew-resize',r:'ew-resize'};
export function cropBasis(camera){const q=new THREE.Quaternion(...camera.quaternion);return {forward:new THREE.Vector3(0,0,-1).applyQuaternion(q).toArray(),right:new THREE.Vector3(1,0,0).applyQuaternion(q).toArray(),up:new THREE.Vector3(0,1,0).applyQuaternion(q).toArray()};}
export function directionOnPatchPlane(direction,basis){const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),forward=dot(direction,basis.forward);if(forward<=1e-6)return null;return {x:dot(direction,basis.right)*patchPlaneDistance/forward,y:dot(direction,basis.up)*patchPlaneDistance/forward};}
export function cropDirection(point,basis){return basis.forward.map((v,i)=>v*patchPlaneDistance+basis.right[i]*point.x+basis.up[i]*point.y);}
export function handlePoint(crop,handle){return {x:handle==='t'||handle==='b'?(crop.minX+crop.maxX)/2:handle.includes('l')?crop.minX:crop.maxX,y:handle==='l'||handle==='r'?(crop.minY+crop.maxY)/2:handle.includes('t')?crop.maxY:crop.minY};}
export function cropDirections(crop,basis){return ['tl','tr','br','bl'].map(h=>new THREE.Vector3(...cropDirection(handlePoint(crop,h),basis)).normalize().toArray());}
export function patchFrame(patch){
 if(patch.kind!=='local')return null;
 if(patch.crop)return structuredClone(patch.crop);
 const basis=cropBasis(patch.camera),points=patch.regions.flatMap(r=>r.directions.map(d=>directionOnPatchPlane(d,basis)));
 if(!points.length||points.some(p=>!p))return null;
 return {basis,bounds:{minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y))}};
}
export function resizePatchCrop(initial,handle,point){
 if(!cropHandles.includes(handle)||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('无效的编辑范围');
 const crop={...initial};
 if(handle.includes('l'))crop.minX=Math.min(point.x,initial.maxX-minimumPatchSpan);
 if(handle.includes('r'))crop.maxX=Math.max(point.x,initial.minX+minimumPatchSpan);
 if(handle.includes('t'))crop.maxY=Math.max(point.y,initial.minY+minimumPatchSpan);
 if(handle.includes('b'))crop.minY=Math.min(point.y,initial.maxY-minimumPatchSpan);
 return crop;
}
export function effectivePatchRegions(patch){return patch.crop?[{id:patch.id,directions:cropDirections(patch.crop.bounds,patch.crop.basis)}]:patch.regions;}
export function hitPatch(direction,patches){
 let hit=null;
 for(const patch of patches){if(patch.kind!=='local'||patch.deletedAt||patch.enabled===false)continue;const frame=patchFrame(patch);if(!frame)continue;const point=directionOnPatchPlane(direction,frame.basis),b=frame.bounds;if(!point||point.x<b.minX||point.x>b.maxX||point.y<b.minY||point.y>b.maxY)continue;const area=(b.maxX-b.minX)*(b.maxY-b.minY);if(!hit||area<hit.area)hit={id:patch.id,area};}
 return hit?.id||null;
}

export function validCropBounds(bounds){return !!bounds&&['minX','maxX','minY','maxY'].every(k=>Number.isFinite(bounds[k])&&Math.abs(bounds[k])<=10000)&&bounds.maxX-bounds.minX>=minimumPatchSpan&&bounds.maxY-bounds.minY>=minimumPatchSpan;}
export function currentCropDrag(editor,drag){return !!drag&&editor.id===drag.token&&editor.history.revision===drag.revision&&editor.selectedPatchId===drag.id;}
