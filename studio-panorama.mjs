import * as THREE from 'three';
import {panoramaIcons} from './studio-panorama-icons.mjs';
import {PanoramaHistory,rectangleDirections,projectRegion,regionColors,makePanoramaRequest,matchesPanoramaRequest} from './studio-panorama-math.mjs';

const copy=value=>structuredClone(value),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function capturePanorama(studio,{width=2048,position=studio.camera.position}={}){
  const renderer=studio.renderer,size=renderer.getSize(new THREE.Vector2()),ratio=renderer.getPixelRatio(),viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest(),renderTarget=renderer.getRenderTarget(),cubeFace=renderer.getActiveCubeFace(),mipLevel=renderer.getActiveMipmapLevel(),xrEnabled=renderer.xr.enabled,hidden=[];
  const hide=object=>{if(object){hidden.push([object,object.visible]);object.visible=false;}};
  const target=new THREE.WebGLCubeRenderTarget(width/4,{type:THREE.HalfFloatType}),cube=new THREE.CubeCamera(.03,1000,target);
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({uniforms:{map:{value:target.texture}},vertexShader:'varying vec2 uvOut; void main(){uvOut=uv;gl_Position=vec4(position,1.0);}',fragmentShader:'uniform samplerCube map; varying vec2 uvOut; void main(){float phi=(uvOut.x-0.5)*6.28318530718;float theta=(1.0-uvOut.y)*3.14159265359;vec3 dir=vec3(sin(theta)*sin(phi),cos(theta),-sin(theta)*cos(phi));gl_FragColor=textureCube(map,dir);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'}));
  try{
    hide(studio.transform.getHelper());hide(studio.motionPath);hide(studio.placementGhost);
    for(const [id,item]of studio.entities)if(studio.object(id)?.kind==='camera')hide(item.root);
    cube.position.copy(position);renderer.setScissorTest(false);cube.update(renderer,studio.scene);
    const scene=new THREE.Scene();scene.add(plane);renderer.setRenderTarget(null);renderer.setPixelRatio(1);renderer.setSize(width,width/2,false);renderer.setViewport(0,0,width,width/2);renderer.render(scene,new THREE.Camera());
    return renderer.domElement.toDataURL('image/png');
  }finally{
    renderer.xr.enabled=xrEnabled;renderer.setRenderTarget(renderTarget,cubeFace,mipLevel);renderer.setPixelRatio(ratio);renderer.setSize(size.x,size.y,false);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    for(const [object,visible]of hidden)object.visible=visible;
    plane.geometry.dispose();plane.material.dispose();target.dispose();
  }
}

function previewSphere(texture){
  const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{map:{value:texture}},vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D map;varying vec3 direction;void main(){vec3 d=normalize(direction);vec2 uv=vec2(atan(d.x,-d.z)/6.28318530718+0.5,asin(clamp(d.y,-1.0,1.0))/3.14159265359+0.5);gl_FragColor=texture2D(map,uv);\n#include <colorspace_fragment>\n}',toneMapped:false});
  return new THREE.Mesh(new THREE.SphereGeometry(100,64,32),material);
}

export function installPanorama(Studio,{el,button}){
  const tick=Studio.prototype.tick,close=Studio.prototype.close,keyDown=Studio.prototype.keyDown,switchSetup=Studio.prototype.switchSetup;
  const control=(name,label,fn,text)=>{const b=button(name,label,fn,text);if(panoramaIcons[label]){b.querySelector('svg')?.remove();b.insertAdjacentHTML('afterbegin',panoramaIcons[label]);}return b;};
  Object.assign(Studio.prototype,{
    async switchSetup(...args){this.closePanoramaEditor();return switchSetup.apply(this,args);},
    capturePanorama(options){return capturePanorama(this,options);},
    async exportPanorama(){const e=this.panoramaEditor;let image=e?.live?this.capturePanorama({position:e.camera.position}):e?.history.state.image||this.capturePanorama();if(image.startsWith('asset:')){const blob=await fetch(await window.LocalAssets.url(image)).then(r=>r.blob());image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}const nodes=window.CanvasApp.createConnected(this.nodeId,[{type:'image',title:'片场全景图',image,width:2048,height:1024}]);this.notify('360° 全景图已添加到画布');return {nodeId:nodes[0].id};},
    async openPanoramaEditor(){
      if(this.panoramaEditor||this.panoramaOpening)return;
      if(this.recorder){this.notify('请先结束片场录制');return;}
      this.panoramaOpening=true;
      try{
        this.cancelPlacement();this.closePlacementMenus?.();this.root.querySelectorAll('.studio-popup,.studio-env-shell').forEach(e=>e.remove());
        if(this.cameraEdit)this.finishCamera(true);if(this.viewfinder)this.toggleViewfinder();if(this.topView)this.setTopView(false);
        this.setPlayback(false);this.keys.clear();this.controls.enabled=false;
        const editor={id:crypto.randomUUID(),setupId:this.data.activeSetup,camera:this.camera.clone(),abort:new AbortController(),mode:'select',history:new PanoramaHistory(),previewScene:new THREE.Scene(),textureSequence:0,applied:new Set(),busy:false};
        editor.camera.aspect=this.viewport.clientWidth/this.viewport.clientHeight;editor.camera.updateProjectionMatrix();
        editor.base=this.capturePanorama();editor.history.state.image=editor.base;
        this.panoramaEditor=editor;this.root.classList.add('studio-panorama-active');
        const layer=el('section','studio-panorama');layer.setAttribute('aria-label','全景图编辑器');editor.layer=layer;this.root.append(layer);
        const surface=el('div','studio-panorama-surface');surface.tabIndex=0;surface.setAttribute('aria-label','全景图视口');editor.surface=surface;layer.append(surface);
        const overlay=document.createElementNS('http://www.w3.org/2000/svg','svg');overlay.classList.add('studio-panorama-regions');editor.overlay=overlay;surface.append(overlay);editor.badges=el('div','studio-panorama-badges');surface.append(editor.badges);
        const top=el('div','studio-panorama-top');top.append(control('back','退出全景图编辑',()=>this.closePanoramaEditor(),'全景图编辑'));layer.append(top);
        const logo=el('div','studio-logo'),img=el('img');img.src='/assets/tap-logo.webp';logo.append(img,document.createTextNode('TapNow'));layer.append(logo);
        const bottom=el('div','studio-panorama-bottom'),exports=el('div','studio-panorama-exports');
        exports.append(control('plus','重新取景',()=>this.reframePanorama()),control('download','导出全景图到画布',()=>this.exportPanorama().catch(error=>this.notify(error.message)),'导出全景图到画布'),control('download','下载全景图',()=>this.downloadPanorama(),'下载全景图'));exports.firstElementChild.hidden=!this.data.panoramaEdits?.length;bottom.append(exports);
        const composer=el('div','studio-panorama-composer'),toolbar=el('div','studio-panorama-toolbar'),tools=el('div','studio-panorama-tools');editor.tools={};
        for(const [mode,label,name]of [['rotate','拖拽旋转','hand'],['select','框选','rect']]){const b=control(name,label,()=>{if(editor.selectedPatchId)this.selectPanoramaPatch(null);editor.mode=mode;this.refreshPanoramaUI();});editor.tools[mode]=b;tools.append(b);}
        const history=el('div','studio-panorama-tools');editor.undo=control('undo','撤销',()=>this.panoramaUndo());editor.redo=control('redo','重做',()=>this.panoramaUndo(true));editor.clear=control('eraser','清除全部',()=>this.panoramaChange({regions:[]}),'全部');history.append(editor.undo,editor.redo,editor.clear);toolbar.append(tools,history);composer.append(toolbar);
        const input=el('div','studio-panorama-input');editor.tokens=el('div','studio-panorama-tokens');input.append(editor.tokens);
        const prompt=el('div','studio-panorama-prompt');prompt.contentEditable='true';prompt.setAttribute('role','textbox');prompt.setAttribute('aria-label','全景图修改描述');prompt.setAttribute('data-placeholder','可选：移动到目标位置后，描述想怎么修改整张全景图');prompt.oninput=()=>this.refreshPanoramaUI();editor.prompt=prompt;input.append(prompt);composer.append(input);editor.error=el('div','studio-panorama-error');composer.append(editor.error);
        const footer=el('div','studio-panorama-footer');editor.note=el('span');editor.generate=control('arrowUp','Generate',()=>this.submitPanorama().catch(error=>this.notify(error.message)),'');footer.append(editor.note,editor.generate);composer.append(footer);bottom.append(composer);layer.append(bottom);
        const hint=el('div','studio-panorama-hint','左键拖动可以选择编辑区域，中键拖动可以环视');hint.append(control(null,'关闭全景操作提示',()=>hint.remove(),'知道了'));layer.append(hint);
        const signal=editor.abort.signal;
        surface.addEventListener('pointerdown',event=>{
          if(event.target.closest('button')||editor.compositing)return;if(editor.selectedPatchId){this.selectPanoramaPatch(null);return;}if(editor.mode==='select'&&event.button===0)this.freezePanoramaView?.();event.preventDefault();surface.focus();surface.setPointerCapture(event.pointerId);
          editor.drag={start:{x:event.clientX,y:event.clientY},last:{x:event.clientX,y:event.clientY},rotate:event.button===1||event.button===2||editor.mode==='rotate'};
        },{signal});
        surface.addEventListener('pointermove',event=>{
          const drag=editor.drag;if(!drag)return;
          if(drag.rotate){const rotation=new THREE.Euler().setFromQuaternion(editor.camera.quaternion,'YXZ');rotation.y-=(event.clientX-drag.last.x)*.003;rotation.x=clamp(rotation.x-(event.clientY-drag.last.y)*.003,-Math.PI*.49,Math.PI*.49);editor.camera.quaternion.setFromEuler(rotation);}
          else editor.draft=rectangleDirections(drag.start,{x:event.clientX,y:event.clientY},surface.getBoundingClientRect(),editor.camera);
          drag.last={x:event.clientX,y:event.clientY};this.renderPanoramaRegions();
        },{signal});
        surface.addEventListener('pointerup',()=>{if(editor.draft){const regions=[...editor.history.state.regions,{id:crypto.randomUUID(),color:regionColors[editor.history.state.regions.length%regionColors.length],directions:editor.draft}];this.panoramaChange({regions});}editor.draft=null;editor.drag=null;this.renderPanoramaRegions();},{signal});
        surface.addEventListener('pointercancel',()=>{editor.draft=null;editor.drag=null;this.renderPanoramaRegions();},{signal});
        surface.addEventListener('contextmenu',event=>event.preventDefault(),{signal});
        surface.addEventListener('wheel',event=>{event.preventDefault();editor.camera.fov=clamp(editor.camera.fov*Math.exp(event.deltaY*.001),15,110);editor.camera.updateProjectionMatrix();this.renderPanoramaRegions();},{passive:false,signal});
        this.refreshPanoramaUI();await this.loadPanoramaPreview(editor);surface.focus();
      }catch(error){this.notify('全景编辑器打开失败：'+error.message);this.closePanoramaEditor();}finally{this.panoramaOpening=false;}
    },
    async loadPanoramaPreview(editor,imageOverride){
      const sequence=++editor.textureSequence,image=imageOverride??editor.history.state.image,token=editor.id;
      const texture=await new THREE.TextureLoader().loadAsync(await window.LocalAssets.url(image));texture.colorSpace=THREE.SRGBColorSpace;
      if(this.panoramaEditor!==editor||sequence!==editor.textureSequence||token!==editor.id){texture.dispose();return;}
      if(editor.sphere){editor.previewScene.remove(editor.sphere);editor.sphere.geometry.dispose();editor.sphere.material.dispose();editor.texture.dispose();}
      editor.texture=texture;editor.sphere=previewSphere(texture);editor.previewScene.add(editor.sphere);
    },
    panoramaChange(patch){const editor=this.panoramaEditor;if(!editor)return;editor.history.change({...editor.history.state,...patch});this.refreshPanoramaUI();this.renderPanoramaRegions();},
    async panoramaUndo(redo=false){const editor=this.panoramaEditor;if(!editor)return;const image=editor.history.state.image;if(editor.history.undo(redo)){this.refreshPanoramaUI();this.renderPanoramaRegions();if(image!==editor.history.state.image)try{await this.loadPanoramaPreview(editor);}catch(error){this.notify(error.message);}}},
    refreshPanoramaUI(){const editor=this.panoramaEditor;if(!editor)return;for(const [mode,b]of Object.entries(editor.tools))b.setAttribute('aria-pressed',String(mode===editor.mode));editor.surface.dataset.mode=editor.mode;editor.undo.disabled=!editor.history.past.length;editor.redo.disabled=!editor.history.future.length;editor.clear.disabled=!editor.history.state.regions.length;editor.generate.disabled=editor.busy||(!editor.prompt.textContent.trim()&&!editor.history.state.regions.length);editor.generate.title=editor.busy?'正在生成':'Generate';editor.note.textContent=editor.busy?'正在生成全景图…':editor.history.state.regions.length?'按当前视角修改标注区域':'将修改整张全景图';editor.error.replaceChildren();if(editor.jobError){editor.error.append(el('span','',editor.jobError));if(editor.jobStatus==='configuration_required')editor.error.append(control(null,'连接全景生成 API',()=>window.GenerationAPI.configure(),'连接 API'));}editor.tokens.replaceChildren();editor.history.state.regions.forEach((region,i)=>{const token=el('button','studio-panorama-token');token.textContent=(i+1)+' 标注区域';token.style.setProperty('--region-color',region.color);token.title='删除此区域';token.onclick=()=>this.panoramaChange({regions:editor.history.state.regions.filter(r=>r.id!==region.id)});editor.tokens.append(token);});},
    renderPanoramaRegions(){
      const editor=this.panoramaEditor;if(!editor)return;editor.overlay.hidden=editor.badges.hidden=!!editor.selectedPatchId;const rect=editor.surface.getBoundingClientRect();const renderKey=JSON.stringify([rect.width,rect.height,editor.camera.quaternion.toArray(),editor.camera.fov,editor.history.revision,editor.draft]);if(editor.renderKey===renderKey)return;editor.renderKey=renderKey;const viewport={left:0,top:0,width:rect.width,height:rect.height};editor.overlay.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);editor.overlay.replaceChildren();editor.badges.replaceChildren();
      const regions=[...editor.history.state.regions,...(editor.draft?[{directions:editor.draft,color:regionColors[editor.history.state.regions.length%regionColors.length],draft:true}]:[])];
      regions.forEach((region,i)=>{const points=projectRegion(region.directions,editor.camera,viewport);if(points.length<3)return;const polygon=document.createElementNS('http://www.w3.org/2000/svg','polygon');polygon.setAttribute('points',points.map(p=>`${p.x},${p.y}`).join(' '));polygon.setAttribute('fill',region.color);polygon.setAttribute('fill-opacity','.22');polygon.setAttribute('stroke',region.color);polygon.setAttribute('stroke-width','2');editor.overlay.append(polygon);if(region.draft)return;const badge=el('div','studio-panorama-badge');badge.style.left=(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2+'px';badge.style.top=(Math.min(...points.map(p=>p.y))+Math.max(...points.map(p=>p.y)))/2+'px';badge.append(el('span','',String(i+1)),control('close','删除此区域',()=>this.panoramaChange({regions:editor.history.state.regions.filter(r=>r.id!==region.id)})));editor.badges.append(badge);});
    },
    async panoramaAction(args){
      if(args.action==='open'){await this.openPanoramaEditor();if(!this.panoramaEditor)throw Error('无法打开全景编辑器');}
      const editor=this.panoramaEditor;if(!editor)throw Error('请先打开全景编辑器');
      if(args.action==='close'){this.closePanoramaEditor();return {open:false};}
      if(args.action==='region'){
        this.freezePanoramaView?.();
        const r=args.rect;if(!r||r.x+r.width>1||r.y+r.height>1)throw Error('选区必须位于 0–1 视口范围内');
        const v=editor.surface.getBoundingClientRect(),directions=rectangleDirections({x:v.left+r.x*v.width,y:v.top+r.y*v.height},{x:v.left+(r.x+r.width)*v.width,y:v.top+(r.y+r.height)*v.height},v,editor.camera);if(!directions)throw Error('选区过小');
        this.panoramaChange({regions:[...editor.history.state.regions,{id:crypto.randomUUID(),directions,color:regionColors[editor.history.state.regions.length%regionColors.length]}]});
      }
      if(args.action==='clear')this.panoramaChange({regions:[]});
      if(args.action==='undo'||args.action==='redo')await this.panoramaUndo(args.action==='redo');
      if(args.action==='generate'){if(typeof args.prompt!=='string')throw Error('请输入修改描述');editor.prompt.textContent=args.prompt;return this.submitPanorama();}
      return {open:true,sessionId:editor.id,setupId:editor.setupId,revision:editor.history.revision,regions:copy(editor.history.state.regions),camera:{position:editor.camera.position.toArray(),quaternion:editor.camera.quaternion.toArray(),fov:editor.camera.fov}};
    },
    reframePanorama(){this.closePanoramaEditor();this.notify('移动到新的位置后，打开环境 → 编辑全景图重新取景');},
    async downloadPanorama(){
      const editor=this.panoramaEditor;if(!editor)return;this.freezePanoramaView?.();
      try{const response=await fetch(await window.LocalAssets.url(editor.history.state.image));if(!response.ok)throw Error('无法读取全景图片');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='片场全景图.png';document.body.append(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(url);},10000);}catch(error){this.notify('下载失败：'+error.message);}
    },
    async submitPanorama(){
      const editor=this.panoramaEditor;if(!editor||editor.busy||editor.compositing||editor.selectedPatchId)throw Error('请等待当前任务完成并退出历史编辑选择后再生成');
      this.freezePanoramaView?.();
      const request=makePanoramaRequest({nodeId:this.nodeId,setupId:editor.setupId,sessionId:editor.id,history:editor.history,camera:editor.camera,prompt:editor.prompt.textContent,image:editor.history.state.image});
      editor.busy=true;editor.jobError=null;this.refreshPanoramaUI();
      try{
        const blob=await fetch(await window.LocalAssets.url(request.inputs[0].image)).then(r=>{if(!r.ok)throw Error('无法读取当前全景图');return r.blob();});
        request.inputs[0].image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
        if(this.panoramaEditor!==editor||editor.history.revision!==request.parameters.binding.revision)throw Error('提交期间编辑会话已变化，请重新提交');
        const job=window.GenerationAPI.submit(request);editor.jobId=job.id;editor.unsubscribe?.();
        editor.unsubscribe=window.GenerationAPI.subscribe(value=>{if(value.id!==job.id)return;if(['configuration_required','failed','cancelled','succeeded'].includes(value.status)){editor.busy=false;editor.jobStatus=value.status;editor.jobError=value.error||null;if(this.panoramaEditor===editor)this.refreshPanoramaUI();editor.unsubscribe?.();editor.unsubscribe=null;}});
        return {taskId:job.id,status:job.status};
      }catch(error){editor.busy=false;editor.jobError=error.message;if(this.panoramaEditor===editor)this.refreshPanoramaUI();throw error;}
    },
    async acceptPanoramaGeneration(job){
      const editor=this.panoramaEditor,binding=job.request.parameters?.binding;
      const context=()=>this.panoramaEditor===editor&&editor?{nodeId:this.nodeId,setupId:this.data.activeSetup,sessionId:editor.id,revision:editor.history.revision}:null;
      if(editor?.applied.has(job.id))return {applied:true,duplicate:true};
      if(!matchesPanoramaRequest(binding,context()))return {applied:false,reason:'编辑会话或选区已改变，结果保留在画布'};
      const output=job.outputs.find(o=>o.type==='image');if(!output)throw Error('全景编辑接口必须返回图片');
      const response=await fetch(output.image||output.url);if(!response.ok)throw Error('全景结果下载失败');const blob=await response.blob(),bitmap=await createImageBitmap(blob);const ratio=bitmap.width/bitmap.height;bitmap.close();if(Math.abs(ratio-2)>.01)throw Error('全景结果必须是已合成的 2:1 等距柱状投影图片');
      const image=await window.LocalAssets.put(blob);if(!matchesPanoramaRequest(binding,context()))return {applied:false,reason:'加载期间编辑会话已改变，结果保留在画布'};
      return this.commitPanoramaOutput(job,image);
    },
    closePanoramaEditor(){const editor=this.panoramaEditor;if(!editor){this.controls.enabled=true;return;}clearTimeout(editor.confirmTimer);editor.abort.abort();editor.unsubscribe?.();editor.textureSequence++;editor.texture?.dispose();editor.sphere?.geometry.dispose();editor.sphere?.material.dispose();editor.layer.remove();this.panoramaEditor=null;this.root.classList.remove('studio-panorama-active');this.controls.enabled=true;this.keys.clear();this.resize();this.clock.getDelta();},
    keyDown(event){if(this.closing)return;if(event.defaultPrevented||event.isComposing||document.querySelector('dialog[open]')||!this.root.contains(event.target))return;if(!this.panoramaEditor)return keyDown.call(this,event);if(event.target.closest('input,textarea,[contenteditable]'))return;event.stopImmediatePropagation();if(this.panoramaEditor.live&&['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft'].includes(event.code)){event.preventDefault();this.keys.add(event.code);}if(event.code==='Escape'){event.preventDefault();this.closePanoramaEditor();}if((event.metaKey||event.ctrlKey)&&event.code==='KeyZ'){event.preventDefault();void this.panoramaUndo(event.shiftKey);}},
    tick(){const editor=this.panoramaEditor;if(!editor)return tick.call(this);if(this.closed)return;const delta=Math.min(this.clock.getDelta(),.05);const width=this.viewport.clientWidth,height=this.viewport.clientHeight;if(editor.camera.aspect!==width/height){editor.camera.aspect=width/height;editor.camera.updateProjectionMatrix();}if(editor.live){this.renderer.setViewport(0,0,width,height);this.renderLivePanorama(delta);}else if(editor.sphere){const camera=editor.camera.clone();camera.position.set(0,0,0);this.renderer.setViewport(0,0,width,height);this.renderer.render(editor.previewScene,camera);}this.renderPanoramaRegions();},
    async close(){await close.call(this);this.closePanoramaEditor();}
  });
}
