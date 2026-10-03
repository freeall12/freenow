import * as THREE from 'three';

// Official Studio It: retain each native material's alpha/deformation pipeline,
// then replace the final color with a linear 24-bit node ID.
export class ScenePicker {
  constructor(renderer){
    this.renderer=renderer;this.target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true});this.target.texture.colorSpace=THREE.NoColorSpace;
    this.materials=new Map();this.pending=0;this.disposed=false;this.released=false;
  }
  material(source,id){
    let entries=this.materials.get(source);if(!entries){entries=new Map();this.materials.set(source,entries);}
    let entry=entries.get(id);
    if(!entry){
      const material=source.clone();
      // NormalBlending + transparent=false enables Three's OPAQUE define, which
      // replaces alpha with 1 before our threshold. NoBlending preserves alpha.
      material.onBeforeCompile=(shader,renderer)=>{
        source.onBeforeCompile?.call(material,shader,renderer);
        if(!shader.fragmentShader.includes('diffuseColor')||! /}\s*$/.test(shader.fragmentShader))throw Error('此材质不支持片场像素点选');
        shader.uniforms.studioPickColor={value:new THREE.Vector3((id&255)/255,(id>>8&255)/255,(id>>16&255)/255)};
        shader.fragmentShader='uniform vec3 studioPickColor;\n'+shader.fragmentShader.replace(/}\s*$/, 'if (diffuseColor.a < 0.05) discard;\n gl_FragColor = vec4(studioPickColor, 1.0);\n}');
      };
      material.customProgramCacheKey=()=> 'studio-gpu-picking-v1:'+source.customProgramCacheKey();
      entry={material};entries.set(id,entry);
    }
    const material=entry.material;
    // Source uniforms and textures can change without source.version changing.
    // Copy native properties on reuse, then restore the ID-render overrides.
    material.copy(source);material.blending=THREE.NoBlending;material.transparent=false;material.depthWrite=true;material.toneMapped=false;material.dithering=false;material.visible=id!==0&&source.visible;material.needsUpdate=true;
    return material;
  }
  async pick(stage,content,camera,u,v,nodeForObject,extraRoots=[]){
    if(this.disposed||!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>=1||v<0||v>=1)return null;
    const renderer=this.renderer,canvas=renderer.domElement,view=camera.clone();
    const x=Math.floor(u*canvas.width),y=canvas.height-1-Math.floor(v*canvas.height);
    // A one-pixel camera frustum clips whole point sprites by their centers.
    // Translate the complete physical viewport instead: the clicked pixel is
    // still rendered to a 1x1 target, with its original rasterization phase.
    this.target.viewport.set(-x,-y,canvas.width,canvas.height);this.target.scissor.set(0,0,1,1);this.target.scissorTest=true;
    const state={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),level:renderer.getActiveMipmapLevel(),viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),clearColor:renderer.getClearColor(new THREE.Color()),clearAlpha:renderer.getClearAlpha(),background:stage.background,shadows:renderer.shadowMap.enabled};
    const originals=[],hidden=[],ids=[],index=new Map(),pixels=new Uint8Array(4);let reading;
    this.pending++;
    try{
      try{
        renderer.shadowMap.enabled=false;
        for(const root of stage.children)if(root!==content&&!extraRoots.includes(root)&&root.visible){hidden.push(root);root.visible=false;}
        for(const root of new Set([content,...extraRoots]))root.traverse(object=>{
          if(!object.isMesh&&!object.isLine&&!object.isPoints)return;
          const key=nodeForObject(object);let id=0;
          if(key!==undefined&&key!==null){if(!index.has(key)){if(ids.length>=0xffffff)throw Error('片场对象数量超过像素点选限制');ids.push(key);index.set(key,ids.length);}id=index.get(key);}
          const source=object.material;originals.push({object,source});
          // Unmapped geometry receives an invisible material rather than a
          // normal color that could decode as another object. Children remain.
          object.material=Array.isArray(source)?source.map(material=>this.material(material,id)):this.material(source,id);
        });
        stage.background=null;renderer.setRenderTarget(this.target);renderer.setClearColor(0,0);renderer.clear();renderer.render(stage,view);
        reading=renderer.readRenderTargetPixelsAsync(this.target,0,0,1,1,pixels);
      }finally{
        // Restore before awaiting the GPU fence: the viewport/preview/export
        // renderer must never observe temporary ID materials or hidden roots.
        for(const {object,source} of originals)object.material=source;
        for(const root of hidden)root.visible=true;
        stage.background=state.background;renderer.shadowMap.enabled=state.shadows;renderer.setRenderTarget(state.target,state.face,state.level);renderer.setClearColor(state.clearColor,state.clearAlpha);
      }
      await reading;
      return this.disposed?null:ids[(pixels[0]|pixels[1]<<8|pixels[2]<<16)-1]??null;
    }finally{this.pending--;this.finishDisposal();}
  }
  invalidate(){for(const entries of this.materials.values())for(const {material} of entries.values())material.dispose();this.materials.clear();}
  finishDisposal(){if(this.disposed&&!this.pending&&!this.released){this.released=true;this.target.dispose();this.resolveDispose?.();}}
  dispose(){
    if(!this.disposed){this.disposed=true;this.disposePromise=new Promise(resolve=>{this.resolveDispose=resolve;});this.invalidate();this.finishDisposal();}
    return this.disposePromise;
  }
}

export function bindScenePicking(canvas,runtime,signal){
  const options={signal};let start=null,released=null;
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0){start=null;return;}
    start={id:event.pointerId,x:event.clientX,y:event.clientY};runtime.invalidatePick();
  },options);
  // Navigation releases pointer capture in its bubble listener. Preserve the
  // completed gesture first, so that its lostcapture cannot swallow this click.
  canvas.addEventListener('pointerup',event=>{released=start?.id===event.pointerId?start:null;if(released)start=null;},{...options,capture:true});
  canvas.addEventListener('pointercancel',event=>{if(start?.id===event.pointerId)start=null;released=null;runtime.invalidatePick();},options);
  canvas.addEventListener('lostpointercapture',event=>{if(start?.id===event.pointerId)start=null;},options);
  canvas.addEventListener('pointerup',event=>{
    const origin=released;released=null;
    if(event.button!==0||!origin||Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>4||runtime.transform.dragging||runtime.transform.axis)return;
    Promise.resolve(runtime.pick(event.clientX,event.clientY)).catch(error=>runtime.onError?.(error));
  },options);
}

export function sceneChangeHandler(runtime,onChange){
  return (reason,...args)=>{
    // Playback controls notify "playback"; ordinary advancing frames notify
    // "playback-tick". Keep click-frame semantics during continuous playback.
    if(reason==='playback')runtime.invalidatePick();
    return onChange?.call(runtime,reason,...args);
  };
}
