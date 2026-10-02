import * as THREE from 'three';
import {effectivePatchRegions} from './studio-panorama-crop.mjs';

export function regionPlanes(directions){
 if(!Array.isArray(directions)||directions.length<3||directions.some(d=>!Array.isArray(d)||d.length!==3||d.some(v=>!Number.isFinite(v))||Math.hypot(...d)<1e-9))throw Error('无效的球面选区');
 const points=directions.map(d=>new THREE.Vector3(...d).normalize()),center=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).normalize();
 return points.map((p,i)=>{const normal=p.clone().cross(points[(i+1)%points.length]);if(normal.lengthSq()<1e-15)throw Error('球面选区边界退化');normal.normalize();if(normal.dot(center)<0)normal.negate();return normal.toArray();});
}
export function containsDirection(direction,planes){return planes.every(n=>direction[0]*n[0]+direction[1]*n[1]+direction[2]*n[2]>=-1e-9);}
export function maskPanoramaPixels(base,overlay,width,height,regions){
 if(base.length!==width*height*4||overlay.length!==base.length)throw Error('全景像素尺寸不一致');
 if(!Array.isArray(regions)||!regions.length)throw Error('局部编辑缺少球面选区');
 const planes=regions.map(r=>regionPlanes(r.directions));
 const sin=new Float64Array(width),cos=new Float64Array(width);for(let x=0;x<width;x++){const phi=((x+.5)/width-.5)*Math.PI*2;sin[x]=Math.sin(phi);cos[x]=-Math.cos(phi);}
 for(let y=0;y<height;y++){
  const theta=(y+.5)/height*Math.PI,sy=Math.sin(theta),dy=Math.cos(theta);
  for(let x=0;x<width;x++){
   const direction=[sy*sin[x],dy,sy*cos[x]];
   if(planes.length&&!planes.some(p=>containsDirection(direction,p)))continue;
   const offset=(y*width+x)*4,alpha=overlay[offset+3]/255;
   for(let c=0;c<3;c++)base[offset+c]=Math.round(overlay[offset+c]*alpha+base[offset+c]*(1-alpha));base[offset+3]=255;
  }
 }
 return base;
}
export async function compositePanorama(anchor,{resolve=url=>window.LocalAssets.url(url),load=loadImage,canvas=()=>document.createElement('canvas'),maxWidth=Infinity}={}){
 const base=await load(await resolve(anchor.base)),surface=canvas();const scale=Math.min(1,maxWidth/base.width);surface.width=Math.max(1,Math.round(base.width*scale));surface.height=Math.max(1,Math.round(base.height*scale));const context=surface.getContext('2d',{willReadFrequently:true});context.drawImage(base,0,0,surface.width,surface.height);base.close?.();
 for(const patch of anchor.patches.filter(p=>!p.deletedAt&&p.enabled!==false)){
  const source=await load(await resolve(patch.image)),overlay=canvas();overlay.width=surface.width;overlay.height=surface.height;const ctx=overlay.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,overlay.width,overlay.height);source.close?.();
  if(patch.kind==='global'){context.clearRect(0,0,surface.width,surface.height);context.drawImage(overlay,0,0);continue;}
  const pixels=context.getImageData(0,0,surface.width,surface.height),layer=ctx.getImageData(0,0,surface.width,surface.height);maskPanoramaPixels(pixels.data,layer.data,surface.width,surface.height,effectivePatchRegions(patch));context.putImageData(pixels,0,0);
 }
 return surface.toDataURL('image/png');
}
async function loadImage(url){const response=await fetch(url);if(!response.ok)throw Error('全景图层读取失败');return createImageBitmap(await response.blob());}
export function visibleAnchors(data,setupId){return (data.panoramaSessions||[]).filter(a=>a.setupId===setupId&&!a.deletedAt&&a.patches.some(p=>!p.deletedAt));}
export function saveAnchor(data,anchor){data.panoramaSessions??=[];const i=data.panoramaSessions.findIndex(a=>a.id===anchor.id);if(i>=0)data.panoramaSessions[i]=structuredClone(anchor);else data.panoramaSessions.push(structuredClone(anchor));}
