export const poseLinks = [['head','neck'],['neck','leftElbow'],['neck','rightElbow'],['leftElbow','leftHand'],['rightElbow','rightHand'],['neck','spine'],['spine','leftKnee'],['spine','rightKnee'],['leftKnee','leftFoot'],['rightKnee','rightFoot']];
export function defaultPose() {
  return {head:[300,100],neck:[300,140],leftElbow:[255,180],rightElbow:[345,180],leftHand:[230,240],rightHand:[370,240],spine:[300,200],leftKnee:[270,300],rightKnee:[330,300],leftFoot:[260,380],rightFoot:[340,380]};
}
export class PoseSelection {
  constructor(){this.reset();}
  reset(){this.points=defaultPose();this.selected=new Set();this.drag=null;this.marquee=null;}
  down(point,additive=false){
    const hit=Object.keys(this.points).find(k=>Math.hypot(this.points[k][0]-point[0],this.points[k][1]-point[1])<=10);
    if(hit&&additive){this.selected.has(hit)?this.selected.delete(hit):this.selected.add(hit);return;}
    if(hit){if(!this.selected.has(hit))this.selected.clear();this.drag={keys:this.selected.has(hit)?[...this.selected]:[hit],point};}
    else{if(!additive)this.selected.clear();this.marquee={start:point,end:point};}
  }
  move(point){
    if(this.marquee){this.marquee.end=point;return;}
    if(!this.drag)return;
    const [dx,dy]=point.map((v,i)=>v-this.drag.point[i]);
    for(const key of this.drag.keys){this.points[key][0]+=dx;this.points[key][1]+=dy;}this.drag.point=point;
  }
  up(){
    if(this.marquee){const {start,end}=this.marquee;for(const [key,p]of Object.entries(this.points))if(p.every((v,i)=>v>=Math.min(start[i],end[i])&&v<=Math.max(start[i],end[i])))this.selected.add(key);}
    this.drag=null;this.marquee=null;
  }
}
export function drawPose(ctx,model,color,editing=true){
  const {points,selected,drag,marquee}=model;ctx.clearRect(0,0,600,440);ctx.strokeStyle=color;ctx.lineWidth=6;ctx.lineCap='round';
  for(const [a,b]of poseLinks){ctx.beginPath();ctx.moveTo(...points[a]);ctx.lineTo(...points[b]);ctx.stroke();}
  ctx.beginPath();ctx.arc(...points.head,20,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.stroke();
  for(const [key,p]of Object.entries(points)){
    const moving=editing&&drag?.keys.includes(key),chosen=editing&&selected.has(key);
    ctx.beginPath();ctx.arc(...p,editing?(moving?12:9):3,0,Math.PI*2);ctx.fillStyle=moving?'#ff6b6b':chosen?'#4CAF50':color;
    if(editing&&!moving&&!chosen){ctx.strokeStyle='black';ctx.lineWidth=2;ctx.stroke();}ctx.fill();
    if(moving||chosen){ctx.beginPath();ctx.arc(...p,moving?15:12,0,Math.PI*2);ctx.strokeStyle=moving?'#ff6b6b':'#4CAF50';ctx.lineWidth=2;ctx.stroke();}
  }
  if(editing&&marquee){const {start,end}=marquee;ctx.strokeStyle='#2196F3';ctx.lineWidth=1;ctx.setLineDash([5,5]);ctx.fillStyle='rgba(33,150,243,.1)';ctx.fillRect(...start,end[0]-start[0],end[1]-start[1]);ctx.strokeRect(...start,end[0]-start[0],end[1]-start[1]);ctx.setLineDash([]);}
}
