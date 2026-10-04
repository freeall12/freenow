export const modes={unchanged:'保持不变',static:'固定',cut:'切换',dynamic:'平滑移动'};
export const presets=[['front_close_up','正面',0,0],['side_45','侧前方',45,0],['side_back_45','侧后方',135,0],['back_wide','背面',180,0],['overhead_wide','俯视',0,-45],['low_angle','仰视',0,30]];
export const scales=[['特写',.2],['中景',.5],['全景',.85],['远景',1]];
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
export const point=p=>({azimuth:(finite(p.azimuth)%360+360)%360,distance:Math.max(0,Math.min(1,finite(p.distance))),elevation:Math.max(-90,Math.min(90,finite(p.elevation)))});
export const moving=s=>s.mode==='cut'||s.mode==='dynamic';
export const samePoint=(a,b)=>Math.min(Math.abs(a.azimuth-b.azimuth),360-Math.abs(a.azimuth-b.azimuth))<5&&Math.abs(a.distance-b.distance)<.05&&Math.abs(a.elevation-b.elevation)<.5;
export const initial=duration=>({activeSegmentId:'seg-01',segments:[{segmentId:'seg-01',name:'',instruction:'',startTime:0,endTime:Math.max(.1,finite(duration,5)),mode:'static',pointA:point({azimuth:0,distance:.2,elevation:0})}]});
export const active=state=>state.segments.find(s=>s.segmentId===state.activeSegmentId);
export function setMode(s,mode){if(!Object.hasOwn(modes,mode))throw Error('镜头模式无效');if(['cut','dynamic'].includes(mode)&&s.endTime-s.startTime<.5)throw Error('片段低于 0.5 秒仅支持不变或固定机位');const result={...s,mode};if(moving(result))result.pointB=s.pointB||point({...s.pointA,azimuth:s.pointA.azimuth+45,distance:s.pointA.distance+.2});else delete result.pointB;return result;}
export function setPoint(s,handle,value){const next={...s,[handle==='b'?'pointB':'pointA']:point(value)};if(moving(next)&&next.pointB&&samePoint(next.pointA,next.pointB)){next.mode='static';delete next.pointB;}return next;}
export const canSplit=(state,time)=>state.segments.some(s=>time>s.startTime+.05&&time<s.endTime-.05);
export function split(state,time,id){const index=state.segments.findIndex(s=>time>s.startTime+.05&&time<s.endTime-.05);if(index<0)return state;const s=state.segments[index],next={segmentId:id,name:'',instruction:'',startTime:time,endTime:s.endTime,mode:s.mode==='unchanged'?'unchanged':'static',pointA:point(s.pointB||s.pointA)},segments=state.segments.slice();segments.splice(index,1,{...s,endTime:time},next);return {...state,activeSegmentId:id,segments};}
export function reset(state,duration){const first=state.segments[0];return {...state,activeSegmentId:first.segmentId,segments:[{...first,startTime:0,endTime:duration}]};}
export function request(node,state,source){
  if(!source)throw Error('来源视频尚不可用');let end=0;
  for(const s of state.segments){if(!Number.isFinite(s.startTime)||!Number.isFinite(s.endTime)||Math.abs(s.startTime-end)>.001||s.endTime<=s.startTime)throw Error('分镜时间范围无效');if(!Object.hasOwn(modes,s.mode)||moving(s)&&(!s.pointB||s.endTime-s.startTime<.5))throw Error('分镜运镜参数无效');end=s.endTime;}
  if(!state.segments.length)throw Error('至少需要一个分镜');
  const tracks=state.segments.map(s=>({segmentId:s.segmentId,name:s.name,startTime:s.startTime,endTime:s.endTime,mode:s.mode,pointA:point(s.pointA),...(moving(s)?{pointB:point(s.pointB)}:{}),instruction:s.mode==='unchanged'?'':s.instruction||''}));
  return {kind:'video.reshoot',label:'视频重拍',nodeId:node.id,inputs:[{type:'video',url:source,role:'source_video',nodeId:node.id}],prompt:tracks.map((s,i)=>`${s.name||'分镜 '+(i+1)} (${s.startTime.toFixed(2)}–${s.endTime.toFixed(2)}s): ${s.mode==='unchanged'?'保持原视频内容完全不变':modes[s.mode]+'；'+JSON.stringify(s.pointA)+(s.pointB?' → '+JSON.stringify(s.pointB):'')+'；'+s.instruction}`).join('\n'),parameters:{schemaVersion:1,intent:'video_multi_view',capabilityMode:'prompt_simulation',sourceClip:node.clip||null,aspectRatio:'adaptive',duration:end,tracks,candidateCount:1}};
}
// Matches the original below-node panel reserve, zoom bounds and partial alignment.
export function fitViewport(node,width,height,from){
  const safeHeight=height-88-176,reserve=508*.55,fit=Math.max(.01,.75*Math.min((width-192)/node.width,Math.max(1,safeHeight-reserve)/node.height));
  const scale=Math.min(Math.min(from.scale,Math.max(from.scale*.82,fit)),safeHeight>508?Math.max(.01,(safeHeight-508)/node.height):Infinity);
  const cx=node.x+node.width/2,cy=node.y+node.height/2,keepX=from.x+cx*(from.scale-scale),keepY=from.y+cy*(from.scale-scale);
  const x=keepX+(width/2-cx*scale-keepX)*.25,desiredY=keepY+(88+safeHeight/2-reserve/2-cy*scale-keepY)*.45;
  const minY=88-node.y*scale,maxY=height-176-(node.y+node.height)*scale-508;
  return {x,y:minY<=maxY?Math.max(minY,Math.min(maxY,desiredY)):minY,scale};
}
