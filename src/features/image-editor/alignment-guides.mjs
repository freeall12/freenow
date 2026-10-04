// Official DZ / _$ uses logical object dimensions, not zoom or a rotated
// bounding box. All comparisons use the original position; center wins last.
export function alignmentPlan({left, top, width, height}, artboard) {
  if (![left, top, width, height, artboard.width, artboard.height].every(Number.isFinite)) return {dx:0, dy:0, guides:[]};
  let x=left, y=top;
  const guides=[];
  const checks=[
    ['vertical-left','vertical',left,0,0],
    ['horizontal-top','horizontal',top,0,0],
    ['vertical-right','vertical',left+width,artboard.width,artboard.width-width],
    ['horizontal-bottom','horizontal',top+height,artboard.height,artboard.height-height],
    ['vertical-center','vertical',left+width/2,artboard.width/2,(artboard.width-width)/2],
    ['horizontal-center','horizontal',top+height/2,artboard.height/2,(artboard.height-height)/2]
  ];
  for (const [id,axis,value,position,next] of checks) if (Math.abs(value-position)<10) {
    if(axis==='vertical')x=next;else y=next;
    guides.push({id,axis,position});
  }
  return {dx:x-left,dy:y-top,guides};
}

const origin=value=>typeof value==='number'?value:({left:0,top:0,center:.5,right:1,bottom:1}[value]??0);
export function objectAlignmentBox(target) {
  const width=target.width*(target.scaleX||1),height=target.height*(target.scaleY||1);
  // Local objects may use center origins. Normalize storage convention without
  // introducing rotation/bounding-box behavior absent from the official code.
  return {left:target.left-width*origin(target.originX),top:target.top-height*origin(target.originY),width,height};
}

export function createAlignmentGuides({canvas,container,enabled=()=>true}) {
  const clear=()=>container.replaceChildren();
  const moving=({target})=>{
    clear();
    if(!target||!enabled()||target.excludeFromExport)return;
    const plan=alignmentPlan(objectAlignmentBox(target),{width:canvas.width,height:canvas.height});
    if(plan.dx||plan.dy){target.set({left:target.left+plan.dx,top:target.top+plan.dy});target.setCoords();}
    for(const guide of plan.guides){
      const line=container.ownerDocument.createElement('i');
      line.className='ie-alignment-guide '+guide.axis;line.dataset.alignmentGuide=guide.id;
      line.style[guide.axis==='vertical'?'left':'top']=guide.position+'px';container.append(line);
    }
  };
  canvas.on('object:moving',moving);
  const events=['object:modified','mouse:up','selection:created','selection:updated','selection:cleared'];
  for(const event of events)canvas.on(event,clear);
  return {clear,dispose(){clear();canvas.off('object:moving',moving);for(const event of events)canvas.off(event,clear);}};
}
