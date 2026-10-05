'use strict';
const {encodeRGBA}=require('./generation-png-alpha.cjs');
const {Quaternion,Vector3}=require('three');
const COORDINATES={directions:'world unit vectors; Y up; front -Z',uv:'u=atan2(x,-z)/(2*pi)+0.5; v=asin(y)/pi+0.5; v grows upward'};
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const vector=(value,length)=>Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const inside=(direction,planes)=>planes.every(normal=>dot(direction,normal)>=-1e-9);
function assertPanoramaEditParameters(p){
 if(!exact(p,['binding','camera','regions','output','coordinates'])||!exact(p.binding,['nodeId','setupId','sessionId','revision'])||['nodeId','setupId','sessionId'].some(key=>typeof p.binding[key]!=='string'||!p.binding[key]||p.binding[key].length>200)||!Number.isSafeInteger(p.binding.revision)||p.binding.revision<0)throw fail('全景编辑绑定无效');
 const c=p.camera;
 if(!exact(c,['position','quaternion','fov','aspect'])||!vector(c.position,3)||!vector(c.quaternion,4)||Math.abs(Math.hypot(...c.quaternion)-1)>1e-6||!Number.isFinite(c.fov)||c.fov<15||c.fov>110||!Number.isFinite(c.aspect)||c.aspect<=0||c.aspect>10)throw fail('全景透视相机无效');
 if(!exact(p.output,['projection','width','height','composite'])||p.output.projection!=='equirectangular'||p.output.width!==2048||p.output.height!==1024||p.output.composite!==true||!exact(p.coordinates,Object.keys(COORDINATES))||Object.keys(COORDINATES).some(key=>p.coordinates[key]!==COORDINATES[key]))throw fail('全景投影合同不一致；未重采样');
 if(!Array.isArray(p.regions)||!p.regions.length||p.regions.length>32)throw fail('独立全景局部编辑需要 1–32 个框选区域；无选区的整图编辑不受支持');
 const q=new Quaternion(...c.quaternion),inverse=q.clone().invert(),f=Math.tan(c.fov*Math.PI/360),corners=[];
 const groups=p.regions.map(region=>{
  if(!region||Object.keys(region).some(key=>!['id','color','directions'].includes(key))||typeof region.id!=='string'||!region.id||!Array.isArray(region.directions)||region.directions.length!==4||region.directions.some(d=>!vector(d,3)||Math.abs(Math.hypot(...d)-1)>1e-6))throw fail('全景选区必须为闭合、有序的四个单位方向');
  const points=region.directions.map(d=>new Vector3(...d)),center=points.reduce((sum,d)=>sum.add(d),new Vector3());
  if(center.length()<1e-6)throw fail('全景选区退化或跨越不可证明的半球');center.normalize();
  const planes=points.map((point,index)=>{const normal=point.clone().cross(points[(index+1)%4]);if(normal.length()<1e-8)throw fail('全景选区边缘退化');normal.normalize();if(normal.dot(center)<0)normal.negate();return normal.toArray();});
  if(points.some(point=>!inside(point.toArray(),planes))||planes.some(normal=>dot(normal,center.toArray())<=1e-8))throw fail('全景选区必须为凸四角形，不能自交');
  for(const point of points){const local=point.clone().applyQuaternion(inverse);if(local.z>=-1e-6)throw fail('全景选区不完全位于当前相机前方');const x=local.x/-local.z,y=local.y/-local.z;if(Math.abs(x)>f*c.aspect+1e-7||Math.abs(y)>f+1e-7)throw fail('全景选区已离开当前相机视口；请重新取景');corners.push({x,y});}
  return planes;
 });
 const minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y)),maxY=Math.max(...corners.map(p=>p.y));
 const span=Math.max(maxX-minX,maxY-minY)*1.25;if(!Number.isFinite(span)||span<1e-6)throw fail('全景选区过小');
 const basis={right:new Vector3(1,0,0).applyQuaternion(q).toArray(),up:new Vector3(0,1,0).applyQuaternion(q).toArray(),forward:new Vector3(0,0,-1).applyQuaternion(q).toArray()};
 return {groups,q,inverse,basis,span,centerX:(minX+maxX)/2,centerY:(minY+maxY)/2};
}
const selected=(direction,frame)=>frame.groups.some(planes=>inside(direction,planes));
function directionAt(x,y,width,height){const phi=((x+.5)/width-.5)*Math.PI*2,theta=(y+.5)/height*Math.PI;return [Math.sin(theta)*Math.sin(phi),Math.cos(theta),-Math.sin(theta)*Math.cos(phi)];}
function rgba(image){if(image.channels===4)return Buffer.from(image.pixels);const pixels=Buffer.alloc(image.width*image.height*4);for(let i=0,j=0;i<image.pixels.length;i+=3,j+=4){image.pixels.copy(pixels,j,i,i+3);pixels[j+3]=255;}return pixels;}
function validatePerspectiveSource(source,parameters,size=1024){
 const frame=assertPanoramaEditParameters(parameters);
 if(source.width!==2048||source.height!==1024)throw fail('来源全景实际尺寸必须为合同中的 2048×1024；未缩放');
 const original=rgba(source);for(let i=3;i<original.length;i+=4)if(original[i]!==255)throw fail('全景来源须为完整不透明场景；透明来源不能隐式成为蒙版');
 // Prove at least one raster center in both the crop and panorama before
 // dispatch. Tiny subpixel selections fail locally instead of spending a POST.
 let cropPixel=false,panoPixel=false;
 for(const region of parameters.regions){
  const d=region.directions.reduce((sum,p)=>sum.map((v,i)=>v+p[i]),[0,0,0]),len=Math.hypot(...d);for(let i=0;i<3;i++)d[i]/=len;
  const x=dot(d,frame.basis.right)/dot(d,frame.basis.forward),y=dot(d,frame.basis.up)/dot(d,frame.basis.forward);
  const ix=Math.floor(((x-frame.centerX)/frame.span+.5)*size),iy=Math.floor((.5-(y-frame.centerY)/frame.span)*size);
  if(ix>=0&&ix<size&&iy>=0&&iy<size&&selected(cropDirection(ix,iy,size,frame),frame))cropPixel=true;
  const u=(Math.atan2(d[0],-d[2])/(2*Math.PI)+.5+1)%1,v=.5-Math.asin(d[1])/Math.PI;
  if(selected(directionAt(Math.min(2047,Math.floor(u*2048)),Math.min(1023,Math.max(0,Math.floor(v*1024))),2048,1024),frame))panoPixel=true;
 }
 if(!cropPixel||!panoPixel)throw fail('选区太小，无法证明真实 crop 和全景像素；请扩大框选');
 return {frame,original,width:source.width,height:source.height,size};
}
function cropDirection(x,y,size,frame){
 const px=frame.centerX+((x+.5)/size-.5)*frame.span,py=frame.centerY+(.5-(y+.5)/size)*frame.span;
 const {forward:f,right:r,up:u}=frame.basis,x0=f[0]+r[0]*px+u[0]*py,y0=f[1]+r[1]*px+u[1]*py,z0=f[2]+r[2]*px+u[2]*py,len=Math.hypot(x0,y0,z0);return [x0/len,y0/len,z0/len];
}
function preparePerspectiveEdit(source,parameters,size=1024){
 const validated=validatePerspectiveSource(source,parameters,size),{frame,original}=validated;
 const crop=Buffer.alloc(size*size*4),mask=Buffer.alloc(size*size*4);let editable=0;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const d=cropDirection(x,y,size,frame);
  const u=(Math.atan2(d[0],-d[2])/(2*Math.PI)+.5+1)%1,v=.5-Math.asin(Math.max(-1,Math.min(1,d[1])))/Math.PI;
  const sx=Math.min(source.width-1,Math.floor(u*source.width)),sy=Math.max(0,Math.min(source.height-1,Math.floor(v*source.height))),offset=(y*size+x)*4;
  original.copy(crop,offset,(sy*source.width+sx)*4,(sy*source.width+sx)*4+4);
  if(selected(d,frame))editable++;else mask[offset+3]=255;
 }
 if(!editable||editable===size*size)throw fail('透视蒙版需要真实可编辑像素和保留上下文');
 return {frame,original,width:source.width,height:source.height,size,crop:encodeRGBA(size,size,crop),mask:encodeRGBA(size,size,mask),editablePixels:editable};
}
function reprojectPerspectiveEdit(prepared,result){
 if(result.width!==prepared.size||result.height!==prepared.size)throw Error('编辑结果尺寸与透视 crop 不一致');
 const edited=rgba(result),pixels=Buffer.from(prepared.original),frame=prepared.frame;let changed=0;
 for(let y=0;y<prepared.height;y++)for(let x=0;x<prepared.width;x++){
  const d=directionAt(x,y,prepared.width,prepared.height);if(!selected(d,frame))continue;
  const forward=dot(d,frame.basis.forward);if(forward<=1e-6)throw Error('选区回投无法证明');
  const u=(dot(d,frame.basis.right)/forward-frame.centerX)/frame.span+.5,v=.5-(dot(d,frame.basis.up)/forward-frame.centerY)/frame.span;
  if(u<0||u>=1||v<0||v>=1)throw Error('选区回投越过 crop');
  const index=(Math.floor(v*prepared.size)*prepared.size+Math.floor(u*prepared.size))*4;if(edited[index+3]!==255)throw Error('选区编辑结果含未填充透明像素');
  edited.copy(pixels,(y*prepared.width+x)*4,index,index+4);changed++;
 }
 if(!changed)throw Error('全景选区没有真实输出像素');
 return {bytes:encodeRGBA(prepared.width,prepared.height,pixels),pixels,selectedPixels:changed};
}
module.exports={COORDINATES,assertPanoramaEditParameters,validatePerspectiveSource,preparePerspectiveEdit,reprojectPerspectiveEdit,directionAt,selected};
