import {FabricImage,util} from './assets/image-mask.js';
// Keep masks in each object's local coordinates so later text movement/scaling
// carries the erased area with the object, as the original clipPath editor does.
export function eraseObjects(canvas,path){
 const stroke=path.getBoundingRect();let changed=false;
 for(const object of canvas.getObjects()){
  if(object===path||object.type==='rect'||object.excludeFromExport||!object.visible)continue;
  const b=object.getBoundingRect();if(b.left>stroke.left+stroke.width||b.left+b.width<stroke.left||b.top>stroke.top+stroke.height||b.top+b.height<stroke.top)continue;
  const padding=Math.max(4,object.strokeWidth||0),width=Math.ceil(object.width+padding*2),height=Math.ceil(object.height+padding*2),scale=Math.min(1,4096/Math.max(width,height)),mask=document.createElement('canvas');mask.width=Math.max(1,Math.ceil(width*scale));mask.height=Math.max(1,Math.ceil(height*scale));const ctx=mask.getContext('2d');ctx.scale(scale,scale);const previous=object.clipPath;
  if(previous instanceof FabricImage&&previous.name==='Annotation eraser mask'){const w=previous.width*previous.scaleX,h=previous.height*previous.scaleY;ctx.drawImage(previous.getElement(),(width-w)/2,(height-h)/2,w,h);}else{ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);}
  ctx.translate(width/2,height/2);ctx.transform(...util.invertTransform(object.calcTransformMatrix()));path.globalCompositeOperation='destination-out';path.render(ctx);object.set({clipPath:new FabricImage(mask,{name:'Annotation eraser mask',left:0,top:0,originX:'center',originY:'center',scaleX:1/scale,scaleY:1/scale}),dirty:true});changed=true;
 }
 return changed;
}
