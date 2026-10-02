import * as THREE from 'three';

export const defaultCurve=[.42,0,.58,1];
export const easingOf=track=>track.createInterpolant.studioEasing;
export const validCurve=curve=>Array.isArray(curve)&&curve.length===4&&curve.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&curve[0]<=curve[2]&&curve[1]<=curve[3];
const bezier=(t,a,b)=>3*(1-t)**2*t*a+3*(1-t)*t*t*b+t**3;
export function warp(time,easing,inverse=false){
  if(!easing||easing.duration<=0)return time;const x=Math.max(0,Math.min(1,time/easing.duration));if(x===0||x===1)return x*easing.duration;const [a,b,c,d]=inverse?[easing.curve[1],easing.curve[0],easing.curve[3],easing.curve[2]]:easing.curve;let lo=0,hi=1;for(let i=0;i<40;i++){const mid=(lo+hi)/2;if(bezier(mid,a,c)<x)lo=mid;else hi=mid;}return easing.duration*bezier((lo+hi)/2,b,d);
}
// Three clones interpolant factories. Keeping immutable metadata on the factory preserves undo/isolation.
export function installEasing(track,easing){
  if(!validCurve(easing.curve)||!Number.isFinite(easing.duration)||easing.duration<=0)throw Error('运动曲线参数无效');
  const metadata={curve:[...easing.curve],duration:easing.duration};
  function factory(result){const proxy=Object.create(this);proxy.times=new Float64Array(Array.from(this.times,t=>warp(t,metadata)));const interpolant=this.InterpolantFactoryMethodLinear.call(proxy,result),evaluate=interpolant.evaluate;interpolant.evaluate=function(time){return evaluate.call(this,warp(time,metadata));};return interpolant;}
  factory.studioEasing=metadata;track.createInterpolant=factory;
}
export function transitionType(tracks){if(tracks.some(easingOf))return 'CURVE';const modes=new Set(tracks.map(t=>t.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline?'ORIGINAL':t.getInterpolation()===THREE.InterpolateDiscrete?'STEP':t.getInterpolation()===THREE.InterpolateLinear?'LINEAR':'ORIGINAL'));return modes.size===1?[...modes][0]:'ORIGINAL';}
export function changeEasing(tracks,type,curve=defaultCurve){
  if(!['LINEAR','CURVE','STEP'].includes(type)||!validCurve(curve))throw Error('运动曲线参数无效');const duration=Math.max(...tracks.map(t=>t.times.at(-1)));if(!(duration>0))throw Error('运镜需要大于零的时长');const next=type==='CURVE'?{curve,duration}:null;
  for(const track of tracks){const previous=easingOf(track),times=Array.from(track.times,t=>Math.fround(warp(warp(t,previous),next,true))),isCubic=!!track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline,size=track.getValueSize()/(isCubic?3:1),values=Array.from(track.times).flatMap((_,i)=>Array.from(track.values.slice(i*track.getValueSize()+(isCubic?size:0),i*track.getValueSize()+(isCubic?size:0)+size)));
    if(times.some((t,i)=>i&&t<=times[i-1]))throw Error('曲线使关键帧过于接近，请调整曲线');
    if(track.ValueTypeName==='quaternion')for(let i=size;i<values.length;i+=size){let dot=0;for(let j=0;j<size;j++)dot+=values[i+j]*values[i-size+j];if(dot<0)for(let j=0;j<size;j++)values[i+j]*=-1;}
    track.times=new Float32Array(times);track.values=new Float32Array(values);track.setInterpolation(type==='STEP'?THREE.InterpolateDiscrete:THREE.InterpolateLinear);if(next)installEasing(track,next);
  }
}
export function syncEasing(tracks){const easing=tracks.map(easingOf).find(Boolean);if(!easing)return;const duration=Math.max(...tracks.map(t=>t.times.at(-1)));for(const track of tracks)installEasing(track,{curve:easing.curve,duration});}
export function easingMetadata(track){const easing=easingOf(track);return easing?{times:Array.from(track.times),values:Array.from(track.values),interpolation:'LINEAR',easing:structuredClone(easing)}:null;}
export function restoreEasing(track,metadata){
  const size=track.ValueTypeName==='quaternion'?4:3,m=metadata;
  if(!m||m.interpolation!=='LINEAR'||!validCurve(m.easing?.curve)||!Number.isFinite(m.easing.duration)||m.easing.duration<=0||!Array.isArray(m.times)||!m.times.length||!Array.isArray(m.values)||m.values.length!==m.times.length*size||!m.values.every(Number.isFinite)||m.times.some((t,i)=>!Number.isFinite(t)||t<0||i&&t<=m.times[i-1])||m.times.at(-1)>m.easing.duration)return false;
  const times=new Float32Array(m.times),values=new Float32Array(m.values);if(!values.every(Number.isFinite)||times.some((t,i)=>i&&t<=times[i-1]))return false;
  track.times=times;track.values=values;track.setInterpolation(THREE.InterpolateLinear);installEasing(track,m.easing);return true;
}
// Standard readers receive sampled LINEAR tracks; editable control points live in the official sampler extras.
export function sampleEasing(track){
  const easing=easingOf(track);if(!easing)return track.clone();const stops=[...new Set([0,...track.times,easing.duration].map(Math.fround))].sort((a,b)=>a-b),times=[],values=[],interpolant=track.createInterpolant(),quaternion=track.ValueTypeName==='quaternion';
  const at=time=>{const value=Array.from(interpolant.evaluate(time));return quaternion?new THREE.Quaternion().fromArray(value).normalize().toArray():value;};
  const close=(a,b,actual,alpha)=>quaternion?new THREE.Quaternion().fromArray(a).slerp(new THREE.Quaternion().fromArray(b),alpha).normalize().angleTo(new THREE.Quaternion().fromArray(actual))<1e-6:actual.every((v,i)=>Math.abs(v-(a[i]+(b[i]-a[i])*alpha))<=1e-6*Math.max(1,Math.abs(v),Math.abs(a[i]),Math.abs(b[i])));
  function segment(a,b,av,bv,depth){const fits=[.25,.5,.75].every(alpha=>close(av,bv,at(a+(b-a)*alpha),alpha)),mid=Math.fround((a+b)/2);if(!fits&&mid>a&&mid<b){if(depth>=20||times.length>200000)throw Error('运动曲线过于精细，无法安全导出');const mv=at(mid);segment(a,mid,av,mv,depth+1);segment(mid,b,mv,bv,depth+1);}else{times.push(a);values.push(...av);}}
  for(let i=0;i<stops.length-1;i++)segment(stops[i],stops[i+1],at(stops[i]),at(stops[i+1]),0);times.push(stops.at(-1));values.push(...at(stops.at(-1)));const output=track.clone();output.times=new Float32Array(times);output.values=new Float32Array(values);output.setInterpolation(THREE.InterpolateLinear);return output;
}
