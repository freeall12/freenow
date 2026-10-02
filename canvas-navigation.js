/* Nodes are stored in absolute world coordinates, including members of groups. */
(function(root){
 'use strict';
 const piles=typeof module!=='undefined'?require('./canvas-piles.js'):root.CanvasPiles;
 const search=typeof module!=='undefined'?require('./src/features/canvas-search/core.js'):root.CanvasSearch;
 const valid=n=>n&&[n.x,n.y,n.width,n.height].every(Number.isFinite)&&n.width>0&&n.height>0;
 function visible(nodes){const owner=piles.index(nodes).owner;return nodes.filter(n=>valid(n)&&!n.hidden&&!owner.has(n.id));}
 function bounds(nodes){if(!nodes.length)return null;const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y));return{x,y,width:Math.max(...nodes.map(n=>n.x+n.width))-x,height:Math.max(...nodes.map(n=>n.y+n.height))-y};}
 function latest(nodes){const n=nodes.at(-1);if(!n)return null;const owner=piles.index(nodes).owner.get(n.id),target=owner?nodes.find(n=>n.id===owner):n;return valid(target)&&!target.hidden?target:null;}
 function fit(nodes,viewport,mode='all'){const target=mode==='latest'?latest(nodes):null,b=mode==='latest'?target&&bounds([target]):bounds(visible(nodes));return b&&viewport.width>0&&viewport.height>0?search.fit(b,viewport,mode==='latest'?.5:.1,{min:.15,max:mode==='latest'?.2:2}):null;}
 function intersects(n,view,viewport){const x=n.x*view.scale+view.x,y=n.y*view.scale+view.y;return x+n.width*view.scale>=0&&x<=viewport.width&&y+n.height*view.scale>=0&&y<=viewport.height;}
 // Van Wijk/Nuij camera path (rho=sqrt(2)), as used by the source D3 zoom.
 function interpolate(start,end,viewport){
  const cx=viewport.width/2,cy=viewport.height/2,extent=Math.max(viewport.width,viewport.height),x0=(cx-start.x)/start.scale,y0=(cy-start.y)/start.scale,x1=(cx-end.x)/end.scale,y1=(cy-end.y)/end.scale,w0=extent/start.scale,w1=extent/end.scale,dx=x1-x0,dy=y1-y0,distance2=dx*dx+dy*dy;
  let path;
  if(distance2<1e-12)path=t=>({x:x0+t*dx,y:y0+t*dy,width:w0*Math.exp(t*Math.log(w1/w0))});
  else{const distance=Math.sqrt(distance2),b0=(w1*w1-w0*w0+4*distance2)/(4*w0*distance),b1=(w1*w1-w0*w0-4*distance2)/(4*w1*distance),r0=-Math.asinh(b0),r1=-Math.asinh(b1);path=t=>{const r=r0+(r1-r0)*t,fraction=w0/(2*distance)*(Math.cosh(r0)*Math.tanh(r)-Math.sinh(r0));return{x:x0+fraction*dx,y:y0+fraction*dy,width:w0*Math.cosh(r0)/Math.cosh(r)};};}
  return progress=>{if(progress<=0)return{...start};if(progress>=1)return{...end};const t=progress<.5?4*progress**3:1-(-2*progress+2)**3/2,p=path(t),scale=extent/p.width;return{x:cx-p.x*scale,y:cy-p.y*scale,scale};};
 }
 function wheel(view,delta,point,mac=true){if(delta.ctrlKey){const factor=delta.deltaMode===1?.05:delta.deltaMode?1:.002,scale=Math.max(.15,Math.min(2,view.scale*2**(-delta.deltaY*factor*(mac?10:1)))),ratio=scale/view.scale;return{x:point.x-(point.x-view.x)*ratio,y:point.y-(point.y-view.y)*ratio,scale};}const unit=delta.deltaMode===1?20:1,dx=!mac&&delta.shiftKey?delta.deltaY:delta.deltaX,dy=!mac&&delta.shiftKey?0:delta.deltaY;return{...view,x:view.x-dx*unit*1.2,y:view.y-dy*unit*1.2};}
 function parseView(raw){try{const v=JSON.parse(raw);return v&&[v.x,v.y,v.scale].every(Number.isFinite)&&v.scale>0&&v.scale<=2?{x:v.x,y:v.y,scale:v.scale}:null;}catch{return null;}}
 // Coalesce model work, while remembering a threshold crossing even if the
 // pointer returns to its start before the next paint. Clear before apply so a
 // synchronous render/history callback cannot consume the same point twice.
 function gestureQueue(){
  let pending=null;
  return {
   push(gesture,event,context){
    if(!gesture)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(gesture.mode==='right-pan'?Math.hypot(dx,dy)>3:Math.abs(dx)+Math.abs(dy)>3)gesture.thresholdCrossed=true;
    gesture.lastX=event.clientX;gesture.lastY=event.clientY;
    pending={gesture,clientX:event.clientX,clientY:event.clientY,...context};
   },
   flush(gesture,apply){const point=pending;pending=null;if(!point||point.gesture!==gesture)return null;apply(point);return gesture.mode==='pan'||gesture.mode==='right-pan';},
   clear(){pending=null;},
   get pending(){return pending!==null;}
  };
 }
 const api={visible,bounds,latest,fit,intersects,interpolate,wheel,parseView,gestureQueue};if(typeof module!=='undefined')module.exports=api;else root.CanvasNavigation=api;
})(typeof window!=='undefined'?window:globalThis);
