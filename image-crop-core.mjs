import {safeArea,dragRect} from './image-outpaint-core.mjs';
export {dragRect};
export function openingView(n,width,height){const a=safeArea(width,height),scale=Math.max(.01,Math.min(a.width/n.width,a.height/n.height));return {scale,x:width/2-(n.x+n.width/2)*scale,y:a.y+a.height/2-(n.y+n.height/2)*scale};}
export function ratioRect(width,height,ratio){let w=width,h=w/ratio;if(h>height){h=height;w=h*ratio;}return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};}
export function normalized(rect,width,height){return {x:rect.x/width,y:rect.y/height,width:rect.width/width,height:rect.height/height};}
export function pixels(selection,original){const x=Math.max(0,Math.floor(selection.x*original.width)),y=Math.max(0,Math.floor(selection.y*original.height)),width=Math.min(original.width-x,Math.floor(selection.width*original.width)),height=Math.min(original.height-y,Math.floor(selection.height*original.height));if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)throw Error('裁剪尺寸无效，请扩大选区');return {x,y,width,height};}
