(function(root){
 'use strict';
 const MIN_DURATION=1;
 function validate(clip){if(!clip||typeof clip.id!=='string'||typeof clip.url!=='string'||!clip.url||![clip.trimStart,clip.duration,clip.sourceDuration].every(Number.isFinite)||clip.trimStart<0||clip.duration<=0||clip.sourceDuration<=0||clip.trimStart+clip.duration>clip.sourceDuration+.001)throw Error('片段时间范围无效');return clip;}
 function total(clips){return clips.reduce((sum,c)=>sum+validate(c).duration,0);}
 function locate(clips,time){const duration=total(clips);if(!clips.length)return null;time=Math.max(0,Math.min(duration,Number(time)||0));let start=0;for(let i=0;i<clips.length;i++){const clip=clips[i];if(time<start+clip.duration||i===clips.length-1)return {clip,index:i,start,offset:Math.min(clip.duration,time-start),sourceTime:clip.trimStart+Math.min(clip.duration,time-start)};start+=clip.duration;}}
 function cut(clips,time,id=()=>crypto.randomUUID()){const hit=locate(clips,time);if(!hit||hit.offset<MIN_DURATION||hit.clip.duration-hit.offset<MIN_DURATION)throw Error('切割位置距片段首尾至少1秒');const {clip,index,offset}=hit;return [...clips.slice(0,index),{...clip,id:id(),duration:offset},{...clip,id:id(),trimStart:clip.trimStart+offset,duration:clip.duration-offset},...clips.slice(index+1)];}
 function trim(clips,id,start,end){const clip=clips.find(c=>c.id===id);if(!clip)throw Error('片段不存在');if(![start,end].every(Number.isFinite)||start<0||end>clip.sourceDuration+.001||end-start<MIN_DURATION)throw Error('裁剪后片段至少1秒且不能超出源视频');return clips.map(c=>c.id===id?{...c,trimStart:start,duration:end-start}:c);}
 function trimAt(clips,time,side){if(!['left','right'].includes(side))throw Error('裁剪方向无效');const hit=locate(clips,time);if(!hit)throw Error('时间线没有可裁剪片段');const start=side==='left'?hit.sourceTime:hit.clip.trimStart,end=side==='right'?hit.sourceTime:hit.clip.trimStart+hit.clip.duration;return trim(clips,hit.clip.id,start,end);}
 function reorder(clips,id,to){const from=clips.findIndex(c=>c.id===id);if(from<0||!Number.isInteger(to)||to<0||to>=clips.length)throw Error('片段排序无效');const next=clips.map(c=>({...c})),[clip]=next.splice(from,1);next.splice(to,0,clip);return next;}
 function request(clips){if(!clips.length||clips.length>50||total(clips)>600)throw Error('请选择1–50个片段，总时长最多10分钟');return clips.map(c=>({url:c.url,start:c.trimStart,duration:c.duration}));}
 function originals(clips){const seen=new Set();return clips.filter(clip=>{validate(clip);if(seen.has(clip.url))return false;seen.add(clip.url);return true;});}
 const api={MIN_DURATION,validate,total,locate,cut,trim,trimAt,reorder,request,originals};if(typeof module!=='undefined')module.exports=api;else root.CanvasPlaylistCore=api;
})(typeof window==='undefined'?globalThis:window);
