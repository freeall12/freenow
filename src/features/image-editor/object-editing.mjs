const fail=(code,message)=>Object.assign(new Error(message),{code});
const maskName='Editor eraser mask';

export function sourcePixelDimensions(image){
  const source=image.getElement?.(),width=source?.naturalWidth||source?.videoWidth||source?.width,height=source?.naturalHeight||source?.videoHeight||source?.height;
  return Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0?{width,height}:null;
}

// Crop coordinates refer to the underlying bitmap, even when a previous crop is
// already applied. Its existing content must stay fixed on the artboard.
export function prepareSourceCrop(image,crop,{Point}){
  const source=sourcePixelDimensions(image);
  if(image.type!=='image'||!source)throw fail('invalid_image','裁剪需要已解码的图片图层');
  if(image.clipPath)throw fail('unsupported_clip','此图片包含蒙版，暂不支持裁剪；请先使用未蒙版图片');
  if(!crop||typeof crop!=='object'||Array.isArray(crop)||Object.keys(crop).some(key=>!['x','y','width','height'].includes(key)))throw fail('invalid_crop','裁剪参数无效');
  const {x,y,width,height}=crop;
  if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>source.width||y+height>source.height)throw fail('invalid_crop','裁剪区域超出底层图片像素边界');
  const center=new Point(x-(image.cropX||0)-image.width/2+width/2,y-(image.cropY||0)-image.height/2+height/2).transform(image.calcTransformMatrix());
  return {image,crop:{x,y,width,height},center};
}
export function commitSourceCrop({image,crop,center}){
  image.set({cropX:crop.x,cropY:crop.y,width:crop.width,height:crop.height});image.setPositionByOrigin(center,'center','center');image.setCoords();
}
function maskCompatible(mask,FabricImage){
  return mask instanceof FabricImage&&mask.name===maskName&&!mask.inverted&&!mask.absolutePositioned&&!mask.clipPath&&!mask.angle&&!mask.skewX&&!mask.skewY&&!mask.flipX&&!mask.flipY&&!mask.left&&!mask.top&&mask.originX==='center'&&mask.originY==='center'&&mask.opacity===1&&mask.scaleX>0&&mask.scaleY>0&&!mask.cropX&&!mask.cropY;
}
export function canEraseObject(object,FabricImage){return !object.clipPath||maskCompatible(object.clipPath,FabricImage);}

// Prepare every per-object alpha mask before mutating a single layer. A tainted
// source, unsupported clip, allocation failure or cancelled action cannot leave
// half of the selected layers erased.
export function prepareObjectErasure(objects,path,{FabricImage,util,createCanvas=()=>document.createElement('canvas'),guard=()=>{}}){
  const strokeBounds=path.getBoundingRect(),plans=[];let totalPixels=0;
  for(const object of objects){
    if(!canEraseObject(object,FabricImage))throw fail('unsupported_clip','所选图层含有非编辑器橡皮擦蒙版，暂不支持叠加擦除');
    const matrix=object.calcTransformMatrix();if(!matrix.every(Number.isFinite)||Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-12)throw fail('invalid_transform','图层变换不可逆，无法擦除');
    const bounds=object.getBoundingRect();if(!object.visible||bounds.left>strokeBounds.left+strokeBounds.width||bounds.left+bounds.width<strokeBounds.left||bounds.top>strokeBounds.top+strokeBounds.height||bounds.top+bounds.height<strokeBounds.top)continue;
    const padding=Math.max(4,object.strokeWidth||0),width=Math.ceil(object.width+padding*2),height=Math.ceil(object.height+padding*2),scale=Math.min(1,2048/Math.max(width,height));
    if(![width,height,scale].every(Number.isFinite)||width<=0||height<=0||scale<=0)throw fail('invalid_dimensions','图层尺寸无效，无法擦除');
    const pixelWidth=Math.max(1,Math.ceil(width*scale)),pixelHeight=Math.max(1,Math.ceil(height*scale));totalPixels+=pixelWidth*pixelHeight;
    if(totalPixels>32*1024*1024)throw fail('raster_budget','本次橡皮擦选中图层像素过多，请分批擦除');
    plans.push({object,matrix,width,height,scale,pixelWidth,pixelHeight});
  }
  const prepared=[];
  try{
    for(const {object,matrix,width,height,scale,pixelWidth,pixelHeight}of plans){
      guard();const mask=createCanvas();mask.width=pixelWidth;mask.height=pixelHeight;const ctx=mask.getContext('2d');if(!ctx)throw fail('canvas_unavailable','无法创建橡皮擦蒙版');ctx.scale(scale,scale);
      const previous=object.clipPath;
      if(previous){const w=previous.width*previous.scaleX,h=previous.height*previous.scaleY;ctx.drawImage(previous.getElement(),(width-w)/2,(height-h)/2,w,h);}else{ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);}
      ctx.translate(width/2,height/2);ctx.transform(...util.invertTransform(matrix));path.render(ctx);
      // Validate serializability before committing: masks are part of history and
      // saved Fabric documents, and must never taint the whole document later.
      mask.toDataURL('image/png');
      const clipPath=new FabricImage(mask,{name:maskName,left:0,top:0,originX:'center',originY:'center',scaleX:1/scale,scaleY:1/scale});
      prepared.push({object,clipPath});
    }
    guard();return prepared;
  }catch(error){for(const {clipPath}of prepared){try{clipPath.dispose();}catch{}}throw error;}
}
export function commitObjectErasure(prepared){for(const {object,clipPath}of prepared)object.set({clipPath,dirty:true});}
