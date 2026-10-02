import * as THREE from 'three';

export const regionColors=['#75e845','#f9cc48','#59c8ef','#ef79b4','#b19aff','#ff9461'];
export function screenDirection(x,y,viewport,camera){
  if(!(viewport.width>0&&viewport.height>0))throw Error('无效的渲染区域');
  camera.updateMatrixWorld(true);
  return new THREE.Vector3((x-viewport.left)/viewport.width*2-1,1-(y-viewport.top)/viewport.height*2,.5).unproject(camera).sub(camera.position).normalize().toArray();
}
export function rectangleDirections(start,end,viewport,camera){
  const x0=Math.max(viewport.left,Math.min(start.x,end.x)),x1=Math.min(viewport.left+viewport.width,Math.max(start.x,end.x));
  const y0=Math.max(viewport.top,Math.min(start.y,end.y)),y1=Math.min(viewport.top+viewport.height,Math.max(start.y,end.y));
  if(x1-x0<6||y1-y0<6)return null;
  return [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>screenDirection(x,y,viewport,camera));
}
export function projectRegion(directions,camera,viewport){
  camera.updateMatrixWorld(true);
  // Clip in camera space before perspective division; behind-camera edges must
  // never jump across the viewport when a region passes the panorama seam.
  let polygon=directions.map(d=>new THREE.Vector3(...d).applyQuaternion(camera.quaternion.clone().invert()));
  const f=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)/camera.zoom,a=camera.aspect;
  for(const distance of [p=>-p.z-1e-5,p=>p.x-p.z*f*a,p=>-p.x-p.z*f*a,p=>p.y-p.z*f,p=>-p.y-p.z*f]){
    const out=[];
    for(let i=0;i<polygon.length;i++){
      const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=distance(p),dq=distance(q);
      if(dp>=0)out.push(p);
      if((dp>=0)!==(dq>=0))out.push(p.clone().lerp(q,dp/(dp-dq)));
    }
    polygon=out;if(!polygon.length)return [];
  }
  return polygon.map(p=>({x:viewport.left+(p.x/(-p.z*f*a)+1)*viewport.width/2,y:viewport.top+(1-p.y/(-p.z*f))*viewport.height/2}));
}
export function directionToUV([x,y,z]){const length=Math.hypot(x,y,z);return {u:(Math.atan2(x,-z)/(Math.PI*2)+.5+1)%1,v:.5+Math.asin(Math.max(-1,Math.min(1,y/length)))/Math.PI};}
export class PanoramaHistory {
  constructor(state={regions:[],image:null}){this.state=structuredClone(state);this.past=[];this.future=[];this.revision=0;}
  change(next){this.past.push(structuredClone(this.state));if(this.past.length>60)this.past.shift();this.state=structuredClone(next);this.future=[];this.revision++;}
  undo(redo=false){const from=redo?this.future:this.past,to=redo?this.past:this.future;if(!from.length)return false;to.push(structuredClone(this.state));this.state=from.pop();this.revision++;return true;}
}
export function matchesPanoramaRequest(binding,context){return !!binding&&!!context&&['nodeId','setupId','sessionId','revision'].every(key=>binding[key]===context[key]);}
export function makePanoramaRequest({nodeId,setupId,sessionId,history,camera,prompt,image}){
  if(!prompt.trim()&&!history.state.regions.length)throw Error('请输入修改描述或框选区域');
  return {kind:'panorama.edit',label:'全景图编辑',nodeId,prompt:prompt.trim(),inputs:[{type:'image',image,projection:'equirectangular'}],parameters:{binding:{nodeId,setupId,sessionId,revision:history.revision},camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,aspect:camera.aspect},regions:structuredClone(history.state.regions),output:{projection:'equirectangular',width:2048,height:1024,composite:true},coordinates:{directions:'world unit vectors; Y up; front -Z',uv:'u=atan2(x,-z)/(2*pi)+0.5; v=asin(y)/pi+0.5; v grows upward'}}};
}
