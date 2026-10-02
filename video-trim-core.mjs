export const MIN_CLIP = 1;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function initialRange(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return {start:0,end:0};
  const length = Math.min(3,duration), start = (duration-length)/2;
  return {start,end:start+length};
}
export function constrainRange(duration, start, end) {
  if (!Number.isFinite(duration) || duration <= 0) return {start:0,end:0};
  if (![start,end].every(Number.isFinite)) throw Error('无效的剪辑范围');
  const lo=clamp(Math.min(start,end),0,duration), hi=clamp(Math.max(start,end),0,duration);
  const length=clamp(hi-lo,Math.min(MIN_CLIP,duration),duration), center=(lo+hi)/2;
  const left=clamp(center-length/2,0,duration-length);
  return {start:left,end:left+length};
}
export function moveRange(range, delta, duration) {
  const length=range.end-range.start,start=clamp(range.start+delta,0,duration-length);
  return {start,end:start+length};
}
export function resizeRange(range, edge, time, duration) {
  const min=Math.min(MIN_CLIP,duration);
  return edge==='start'?{start:clamp(time,0,range.end-min),end:range.end}:{start:range.start,end:clamp(time,range.start+min,duration)};
}
export function pointerTime(x,width,duration,precise=false) {
  const raw=clamp(x/Math.max(1,width)*duration,0,duration), snapped=Math.round(raw/.5)*.5;
  return !precise&&Math.abs(snapped-raw)*width/duration<=15?clamp(snapped,0,duration):raw;
}
export function keyboardRange(range,key,{shiftKey=false,ctrlKey=false,metaKey=false,time=0,duration}={}) {
  const step=shiftKey?.01:ctrlKey||metaKey?1:.1;
  if(key==='ArrowLeft'||key==='ArrowRight')return moveRange(range,key==='ArrowLeft'?-step:step,duration);
  if(key==='ArrowUp'||key==='ArrowDown')return resizeRange(range,'end',range.end+(key==='ArrowUp'?step:-step),duration);
  if(key.toLowerCase()==='i'&&time<range.end-MIN_CLIP)return resizeRange(range,'start',time,duration);
  if(key.toLowerCase()==='o'&&time>range.start+MIN_CLIP)return resizeRange(range,'end',time,duration);
  return range;
}
// Color-distribution distance rejects ordinary object motion while detecting
// hard cuts. This is a local detector, not a claim to match the private model.
export function frameSignature(pixels) {
  const bins=new Float64Array(64),count=pixels.length/4;
  for(let i=0;i<pixels.length;i+=4)bins[(pixels[i]>>6)*16+(pixels[i+1]>>6)*4+(pixels[i+2]>>6)]++;
  return Array.from(bins,v=>v/count);
}
export function cutDistance(a,b) { return a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/2; }
export function segmentsFromCuts(duration,cuts) {
  const points=[0];
  for(const t of [...cuts].filter(Number.isFinite).sort((a,b)=>a-b))if(t-points.at(-1)>=MIN_CLIP&&duration-t>=MIN_CLIP)points.push(t);
  points.push(duration);return points.slice(1).map((end,i)=>({start:points[i],end}));
}
