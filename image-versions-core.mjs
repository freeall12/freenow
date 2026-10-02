export const src=n=>n?.fullImage||n?.image||'';
export function values(node,fallback=[]){const seen=new Set(),all=(node.versions??fallback).map(v=>typeof v==='string'?{image:v}:v).filter(v=>src(v));return all.filter(v=>!seen.has(src(v))&&seen.add(src(v))).map(v=>({...v,image:src(v)}));}
export const alternatives=(node,items)=>items.filter(v=>src(v)!==src(node));
export function cell(index,total,size){const cols=Math.min(total+1,total+1>4?4:2),position=index+1;return {x:(size.width+16)*(position%cols),y:-(size.height+16)*Math.floor(position/cols)||0};}
export const closed=index=>index<4?{x:12*(index+1),y:4*(index+1),rotate:5*(index+1),scale:1-(index+1)*.035}:{x:0,y:0,rotate:0,scale:1};
// Unit-mass spring, matching original stiffness 280 and damping 18.
export function spring(t){const w=Math.sqrt(280-81);return 1-Math.exp(-9*t)*(Math.cos(w*t)+9/w*Math.sin(w*t));}
export function mainPatch(node,item,items){return {image:src(item),fullImage:src(item),versions:items,currentSourceFileId:item.sourceFileId||null,...(item.pixelWidth&&item.pixelHeight?{pixelWidth:item.pixelWidth,pixelHeight:item.pixelHeight}:{pixelWidth:null,pixelHeight:null})};}
