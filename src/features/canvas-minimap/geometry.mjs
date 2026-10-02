export const SIZE = {width:200,height:150};

// CanvasApp stores every position in absolute world coordinates, including
// children of groups. Adding the parent's position here would cause drift.
export function nodeBounds(nodes){
  if(!nodes.length)return null;
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const n of nodes){x=Math.min(x,n.x);y=Math.min(y,n.y);right=Math.max(right,n.x+n.width);bottom=Math.max(bottom,n.y+n.height);}
  return{x,y,width:right-x,height:bottom-y};
}
export function geometry(nodes,view,dimensions){return geometryFromBounds(nodeBounds(nodes),view,dimensions);}
export function geometryFromBounds(nodes,view,dimensions){
  const viewport={x:-view.x/view.scale,y:-view.y/view.scale,width:dimensions.width/view.scale,height:dimensions.height/view.scale};
  let x=viewport.x,y=viewport.y,right=x+viewport.width,bottom=y+viewport.height;
  if(nodes){x=Math.min(x,nodes.x);y=Math.min(y,nodes.y);right=Math.max(right,nodes.x+nodes.width);bottom=Math.max(bottom,nodes.y+nodes.height);}
  const bounds={x,y,width:right-x,height:bottom-y};
  const scale=Math.min(SIZE.width/Math.max(bounds.width,1),SIZE.height/Math.max(bounds.height,1));
  return {bounds,scale,offsetX:-x*scale+(SIZE.width-bounds.width*scale)/2,offsetY:-y*scale+(SIZE.height-bounds.height*scale)/2};
}
export function project(rect,map){return{x:rect.x*map.scale+map.offsetX,y:rect.y*map.scale+map.offsetY,width:rect.width*map.scale,height:rect.height*map.scale};}
export function viewportRect(view,dimensions,map){return project({x:-view.x/view.scale,y:-view.y/view.scale,width:dimensions.width/view.scale,height:dimensions.height/view.scale},map);}
export function centerAt(point,view,dimensions,map){return{x:dimensions.width/2-(point.x-map.offsetX)/map.scale*view.scale,y:dimensions.height/2-(point.y-map.offsetY)/map.scale*view.scale,scale:view.scale};}
export function dragTo(delta,start,map){return{x:start.x-delta.x/map.scale*start.scale,y:start.y-delta.y/map.scale*start.scale,scale:start.scale};}
