export const prompt='Naturally redraw the transparent-channel area in the image. Do not generate new objects that do not exist in the scene. Blend the transparent area into the surrounding environment.';
export function openingView(node,width,height){const scale=Math.max(.01,Math.min((width-144)/node.width,(height-280)/node.height));return {scale,x:width/2-(node.x+node.width/2)*scale,y:height/2-(node.y+node.height/2)*scale};}
export function cutAlpha(source,mask){if(source.length!==mask.length||source.length%4)throw Error('蒙版尺寸与原图不一致');let count=0;for(let i=0;i<source.length;i+=4)if(mask[i+3]>0&&mask[i]>200&&mask[i+1]>200&&mask[i+2]>200){source[i+3]=0;count++;}return count;}
export function rectangle(start,end){const width=Math.abs(end.x-start.x),height=Math.abs(end.y-start.y);return width>5||height>5?{left:Math.min(start.x,end.x),top:Math.min(start.y,end.y),width,height}:null;}
export const widthSymbol=n=>Math.max(1.5,n*.12);
