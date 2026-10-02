import {Vector3, Quaternion, Euler, Curve, CubicBezierCurve3} from 'three';

const copy=value=>structuredClone(value);
const vector=value=>new Vector3().fromArray(value);
const bounded=value=>Math.max(0,Math.min(1,value));
class BentPath extends Curve {
  constructor(base,bend){super();this.base=base;this.bend=bend;this.arcLengthDivisions=64;this.v1=base.v1;this.v2=base.v2;}
  getPoint(t,target=new Vector3()){
    this.base.getPoint(t,target);const anchor=Math.max(.05,Math.min(.95,this.bend.t));
    const phase=bounded(t<=anchor?t/anchor:(1-t)/(1-anchor)),weight=phase*phase*(3-2*phase);
    return target.addScaledVector(vector(this.bend.point).sub(this.base.getPoint(anchor)),weight);
  }
}
export function nearestPathParameter(curve,point){
  const target=vector(point),distance=t=>{const p=curve.getPoint(t);return (p.x-target.x)**2+(p.z-target.z)**2;};
  let best=0;for(let i=1;i<=48;i++)if(distance(i/48)<distance(best))best=i/48;
  let lo=Math.max(0,best-1/48),hi=Math.min(1,best+1/48);for(let i=0;i<10;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(distance(a)>distance(b))lo=a;else hi=b;}
  return Math.max(.05,Math.min(.95,(lo+hi)/2));
}
export const VIEWER_TRACK='__legacy_viewer__';

export function migrateKeyframes(records=[]){
  return records.flatMap(frame=>{
    if(frame.entityId&&frame.state)return [copy(frame)];
    const migrated=(frame.objects||[]).map(object=>({id:frame.id+':'+object.id,entityId:object.id,time:frame.time,state:copy(object),interpolation:'linear'}));
    if(frame.camera)migrated.push({id:frame.id+':viewer',entityId:VIEWER_TRACK,time:frame.time,state:copy(frame.camera),interpolation:'linear'});
    return migrated;
  });
}
export function trackFrames(records,entityId){return records.filter(k=>k.entityId===entityId).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));}

export function buildSegments(frames){
  const points=frames.map(k=>vector(k.state.position));
  const tangent=index=>index===0?points[1].clone().sub(points[0]):index===points.length-1?points[index].clone().sub(points[index-1]):points[index+1].clone().sub(points[index-1]).multiplyScalar(.5);
  return frames.slice(0,-1).map((a,index)=>{
    const b=frames[index+1],p0=points[index],p3=points[index+1];
    const p1=a.outControl?vector(a.outControl):p0.clone().addScaledVector(tangent(index),1/3);
    const p2=b.inControl?vector(b.inControl):p3.clone().addScaledVector(tangent(index+1),-1/3);
    const base=new CubicBezierCurve3(p0,p1,p2,p3),bend=a.bendConstraint;
    const curve=bend&&(!bend.toKeyId||bend.toKeyId===b.id)?new BentPath(base,bend):base;curve.arcLengthDivisions=64;
    return {a,b,curve,hold:a.interpolation==='hold',length:a.interpolation==='hold'?0:curve.getLength()};
  });
}
export function sampleTrack(frames,time,segments=buildSegments(frames)){
  if(!frames.length||time<frames[0].time)return null;
  const last=frames.at(-1);if(time>=last.time)return copy(last.state);
  const segment=segments.find(s=>time>=s.a.time&&time<s.b.time);
  if(!segment)return copy(frames[0].state);
  const {a,b,curve,hold}=segment,t=bounded((time-a.time)/(b.time-a.time));
  const state=copy(a.state);if(hold)return state;
  state.position=curve.getPointAt(t).toArray();
  if(a.state.scale&&b.state.scale)state.scale=vector(a.state.scale).lerp(vector(b.state.scale),t).toArray();
  if(a.state.rotation&&b.state.rotation){const q=new Quaternion().setFromEuler(new Euler(...a.state.rotation)).slerp(new Quaternion().setFromEuler(new Euler(...b.state.rotation)),t),r=new Euler().setFromQuaternion(q,'XYZ');state.rotation=[r.x,r.y,r.z];}
  if(a.state.quaternion&&b.state.quaternion)state.quaternion=new Quaternion().fromArray(a.state.quaternion).slerp(new Quaternion().fromArray(b.state.quaternion),t).toArray();
  for(const key of ['focal','fov','aspect','focusDistance','fNumber','apertureFNumber'])if(Number.isFinite(a.state[key])&&Number.isFinite(b.state[key]))state[key]=a.state[key]+(b.state[key]-a.state[key])*t;
  if(a.state.focus?.mode==='distance'&&b.state.focus?.mode==='distance')state.focus={mode:'distance',distance:a.state.focus.distance+(b.state.focus.distance-a.state.focus.distance)*t};
  if(a.state.focus?.mode==='point'&&b.state.focus?.mode==='point')state.focus={mode:'point',target:vector(a.state.focus.target).lerp(vector(b.state.focus.target),t).toArray()};
  return state;
}
export function redistributeTimes(frames){
  if(frames.length<3)return copy(frames);
  const segments=buildSegments(frames),moving=segments.filter(s=>!s.hold&&s.length>1e-8);
  if(moving.length<2)return copy(frames);
  const duration=moving.reduce((sum,s)=>sum+Math.round((s.b.time-s.a.time)*1000),0),distance=moving.reduce((sum,s)=>sum+s.length,0);
  const allocations=moving.map((s,index)=>{const exact=duration*s.length/distance;return {index,value:Math.max(1,Math.floor(exact)),fraction:exact-Math.floor(exact)};});
  let remainder=duration-allocations.reduce((sum,a)=>sum+a.value,0);
  const ordered=allocations.slice().sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
  for(let i=0;remainder>0;i++,remainder--)ordered[i%ordered.length].value++;
  while(remainder<0){const a=allocations.find(a=>a.value>1);if(!a)break;a.value--;remainder++;}
  let time=Math.round(frames[0].time*1000),index=0;
  return frames.map((frame,i)=>{if(i){const segment=segments[i-1];time+=!segment.hold&&segment.length>1e-8?allocations[index++].value:Math.round((segment.b.time-segment.a.time)*1000);}return {...copy(frame),time:time/1000};});
}
export function moveKey(records,id,time,duration){
  const key=records.find(k=>k.id===id);if(!key)throw Error('关键帧不存在');
  const value=Math.round(Math.max(0,Math.min(duration,time))*1000)/1000;
  if(records.some(k=>k.id!==id&&k.entityId===key.entityId&&Math.abs(k.time-value)<.001))throw Error('同一对象在该时间已有关键帧');
  return records.map(k=>k.id===id?{...copy(k),time:value}:copy(k));
}
