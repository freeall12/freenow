import * as THREE from 'three';
import {screenDirection,projectRegion} from './studio-panorama-math.mjs';
import {patchFrame,cropHandles,cropCursors,handlePoint,cropDirection,cropDirections,directionOnPatchPlane,resizePatchCrop,hitPatch,validCropBounds,currentCropDrag} from './studio-panorama-crop.mjs';
import {compositePanorama} from './studio-panorama-layers.mjs';
const names={tl:'左上',t:'上',tr:'右上',r:'右',br:'右下',b:'下',bl:'左下',l:'左'};

export function installPanoramaCrop(Studio,{el}){
 const open=Studio.prototype.openPanoramaEditor,render=Studio.prototype.renderPanoramaRegions,select=Studio.prototype.selectPanoramaPatch,action=Studio.prototype.panoramaAction,renderHistory=Studio.prototype.renderPanoramaHistory;
 Object.assign(Studio.prototype,{
  async openPanoramaEditor(){await open.call(this);const e=this.panoramaEditor;if(!e||e.cropInstalled)return;e.cropInstalled=true;
   const layer=el('div','studio-panorama-crop');e.layer.append(layer);e.cropLayer=layer;
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');svg.append(polygon);layer.append(svg);e.cropPolygon=polygon;e.cropHandles={};
   for(const handle of cropHandles){const b=el('button','studio-panorama-crop-handle');b.setAttribute('aria-label','调整编辑范围'+names[handle]);b.style.cursor=cropCursors[handle];b.append(el('span'));layer.append(b);e.cropHandles[handle]=b;
    b.addEventListener('pointerdown',event=>{event.stopPropagation();event.preventDefault();if(e.compositing||event.button!==0)return;const patch=e.history.state.anchor?.patches.find(p=>p.id===e.selectedPatchId),frame=patch&&patchFrame(patch);if(!frame)return;const point=directionOnPatchPlane(screenDirection(event.clientX,event.clientY,e.surface.getBoundingClientRect(),e.camera),frame.basis);if(!point)return;const target=handlePoint(frame.bounds,handle);e.cropDrag={id:patch.id,handle,frame,offset:{x:point.x-target.x,y:point.y-target.y},token:e.id,revision:e.history.revision,images:new Map()};e.cropDraft=structuredClone(frame);b.setPointerCapture(event.pointerId);},{signal:e.abort.signal});
    b.addEventListener('pointermove',event=>{const drag=e.cropDrag;if(!currentCropDrag(e,drag))return;event.stopPropagation();const point=directionOnPatchPlane(screenDirection(event.clientX,event.clientY,e.surface.getBoundingClientRect(),e.camera),drag.frame.basis);if(!point)return;e.cropDraft={basis:drag.frame.basis,bounds:resizePatchCrop(drag.frame.bounds,drag.handle,{x:point.x-drag.offset.x,y:point.y-drag.offset.y})};e.cropPreviewSequence=(e.cropPreviewSequence||0)+1;this.renderPanoramaCrop();void this.previewPanoramaCrop();},{signal:e.abort.signal});
    const finish=async event=>{const drag=e.cropDrag;if(!drag)return;event.stopPropagation();const crop=e.cropDraft;e.cropDrag=null;e.cropDraft=null;e.cropPreviewSequence=(e.cropPreviewSequence||0)+1;e.textureSequence++;if(b.hasPointerCapture(event.pointerId))b.releasePointerCapture(event.pointerId);try{if(this.panoramaEditor===e&&currentCropDrag(e,drag)){if(event.type==='pointerup'&&JSON.stringify(crop)!==JSON.stringify(drag.frame))await this.mutatePanoramaPatch(drag.id,{crop});else await this.loadPanoramaPreview(e);}}catch(error){this.notify(error.message);}this.renderPanoramaCrop();};
    b.addEventListener('pointerup',finish,{signal:e.abort.signal});b.addEventListener('pointercancel',finish,{signal:e.abort.signal});
   }
   e.surface.addEventListener('pointerdown',event=>{if(event.button!==0||e.mode!=='rotate'||e.compositing)return;const direction=screenDirection(event.clientX,event.clientY,e.surface.getBoundingClientRect(),e.camera),id=hitPatch(direction,e.history.state.anchor?.patches||[]);if(id){event.stopImmediatePropagation();event.preventDefault();e.surface.setPointerCapture(event.pointerId);e.patchClick={id,x:event.clientX,y:event.clientY};e.drag={start:{x:event.clientX,y:event.clientY},last:{x:event.clientX,y:event.clientY},rotate:true};}}, {capture:true,signal:e.abort.signal});
   e.surface.addEventListener('pointerup',event=>{const click=e.patchClick;e.patchClick=null;if(click&&Math.hypot(event.clientX-click.x,event.clientY-click.y)<4)this.selectPanoramaPatch(click.id);},{capture:true,signal:e.abort.signal});
   e.surface.addEventListener('pointercancel',()=>{e.patchClick=null;},{signal:e.abort.signal});
   this.renderPanoramaCrop();
  },
  async panoramaAction(args){if(args.action==='crop_patch'){const e=this.panoramaEditor,patch=e?.history.state.anchor?.patches.find(p=>p.id===args.id),frame=patch&&patchFrame(patch);if(!frame||!args.crop)throw Error('请选择有效的局部编辑层');const b=args.crop;if(!validCropBounds(b))throw Error('编辑范围无效或小于0.5');await this.mutatePanoramaPatch(args.id,{crop:{basis:frame.basis,bounds:structuredClone(b)}});return action.call(this,{action:'read'});}return action.call(this,args);},
  selectPanoramaPatch(id){const e=this.panoramaEditor;if(!e)return;if(e.cropDrag)return;const was=e.selectedPatchId;select.call(this,id);if(e.selectedPatchId){if(!was)e.previousPatchTool=e.mode;e.mode='rotate';}else if(e.previousPatchTool){e.mode=e.previousPatchTool;delete e.previousPatchTool;}this.refreshPanoramaUI();this.renderPanoramaCrop();},
  renderPanoramaRegions(){render.call(this);this.renderPanoramaCrop();},
  renderPanoramaCrop(){
   const e=this.panoramaEditor;if(!e?.cropLayer)return;if(e.cropDrag&&!currentCropDrag(e,e.cropDrag)){e.cropDrag=null;e.cropDraft=null;e.textureSequence++;}const patch=e.history.state.anchor?.patches.find(p=>p.id===e.selectedPatchId&&!p.deletedAt),frame=e.cropDraft||patch&&patchFrame(patch);e.cropLayer.hidden=!frame;if(!frame)return;
   const r=e.surface.getBoundingClientRect(),v={left:0,top:0,width:r.width,height:r.height};e.cropPolygon.parentElement.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);const points=projectRegion(cropDirections(frame.bounds,frame.basis),e.camera,v);e.cropPolygon.setAttribute('points',points.map(p=>`${p.x},${p.y}`).join(' '));this.positionPanoramaPatchActions();const inverse=e.camera.quaternion.clone().invert(),f=Math.tan(THREE.MathUtils.degToRad(e.camera.fov)/2)/e.camera.zoom;
   for(const handle of cropHandles){const b=e.cropHandles[handle],p=new THREE.Vector3(...cropDirection(handlePoint(frame.bounds,handle),frame.basis)).applyQuaternion(inverse),x=(p.x/(-p.z*f*e.camera.aspect)+1)*r.width/2,y=(1-p.y/(-p.z*f))*r.height/2;b.hidden=p.z>=-.01||x<0||x>r.width||y<0||y>r.height;b.style.left=x+'px';b.style.top=y+'px';const pixels=r.height/(2*f*-p.z);b.style.width=b.style.height=Math.max(12,pixels*.5)+'px';b.firstElementChild.style.width=b.firstElementChild.style.height=pixels*.06+'px';b.disabled=!!e.compositing;}
  },
  renderPanoramaHistory(){
   renderHistory.call(this);const e=this.panoramaEditor;if(!e?.rail)return;
   if(!e.hoverPreview){e.hoverPreview=el('div','studio-panorama-hover-preview');e.hoverPreview.hidden=true;e.hoverPreview.setAttribute('role','tooltip');e.hoverPreview.append(el('img'));e.layer.append(e.hoverPreview);e.abort.signal.addEventListener('abort',()=>clearTimeout(e.hoverTimer),{once:true});}
   for(const thumb of e.rail.querySelectorAll('.studio-panorama-patch,.studio-panorama-position>button:first-child')){if(thumb.dataset.previewBound)continue;thumb.dataset.previewBound='true';
    const hide=()=>{clearTimeout(e.hoverTimer);e.hoverPreview.hidden=true;};
    const show=()=>{hide();e.hoverTimer=setTimeout(()=>{if(!thumb.isConnected||this.panoramaEditor!==e)return;const source=thumb.querySelector('img');if(!source?.src)return;const preview=e.hoverPreview,image=preview.firstElementChild;image.src=source.src;image.alt=source.alt;preview.hidden=false;const r=thumb.getBoundingClientRect(),root=e.layer.getBoundingClientRect();preview.style.left=Math.max(8,Math.min(root.width-228,r.left-root.left+r.width/2-110))+'px';preview.style.top=Math.max(8,r.top-root.top-240)+'px';},260);};
    thumb.addEventListener('pointerenter',show);thumb.addEventListener('pointerleave',hide);thumb.addEventListener('focus',show);thumb.addEventListener('blur',hide);thumb.addEventListener('click',hide);
   }
  },
  async previewPanoramaCrop(){
   const e=this.panoramaEditor,drag=e?.cropDrag;if(!drag||e.cropPreviewRunning)return;e.cropPreviewRunning=true;
   try{while(this.panoramaEditor===e&&e.cropDrag===drag&&currentCropDrag(e,drag)){const seq=e.cropPreviewSequence,anchor=structuredClone(e.history.state.anchor);anchor.patches.find(p=>p.id===drag.id).crop=structuredClone(e.cropDraft);
     const load=url=>{if(!drag.images.has(url)){const image=new Image();image.src=url;drag.images.set(url,image.decode().then(()=>image));}return drag.images.get(url);};
     const image=await compositePanorama(anchor,{maxWidth:512,load});if(this.panoramaEditor!==e||e.cropDrag!==drag||!currentCropDrag(e,drag))break;if(seq===e.cropPreviewSequence){await this.loadPanoramaPreview(e,image);if(seq===e.cropPreviewSequence)break;}
   }}catch(error){if(this.panoramaEditor===e)this.notify(error.message);}finally{e.cropPreviewRunning=false;}
  }
 });
}
