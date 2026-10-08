import * as THREE from 'three';
import {inspectSplatHeader,splatLimits,validateSplatDescriptor} from './splat-contract.mjs';
import {materializationScope,readModelBlob} from './materialization.mjs';
import {isStaticAssetRef} from '../local-resource-migration/index-format.mjs';
import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {buildSplatLod,SplatLodController,splatLodPolicy} from './splat-lod.mjs';
let modulePromise;
export const loadSpark=()=>modulePromise||(modulePromise=import('@sparkjsdev/spark').catch(error=>{modulePromise=null;throw error;}));
export function assertLocalSplatSource(source,{asset=true}={}){
  if(typeof source!=='string'||source!==source.trim()||/[\x00-\x20\x7f\\]/.test(source))throw Error('高斯源素材需要真实本地引用');
  if(asset&&/^asset:[^\s]+$/.test(source))return source;
  const base=globalThis.location?.href||'http://localhost/',url=new URL(source,base);
  if(url.origin!==new URL(base).origin||url.username||url.password||!['http:','https:','blob:'].includes(url.protocol)||url.protocol!=='blob:'&&(url.search||url.hash||!isStaticAssetRef(url.pathname)&&!isGenerationMediaRef(url.pathname)))throw Error('请先将 SPZ 保存到本地素材；不能读取外部高斯地址');
  return url.href;
}
export async function readLocalSplat(source,{signal}={}){
  assertLocalSplatSource(source);const scope=materializationScope({signal});
  try{const url=assertLocalSplatSource(await scope.wait(()=>window.LocalAssets.url(source)),{asset:false});const response=await scope.wait(()=>fetch(url,{signal:scope.signal,redirect:'error',credentials:'same-origin'}));return await readModelBlob(response,scope,splatLimits.bytes,{format:'spz',mime:'application/octet-stream'});}finally{scope.close();}
}
export async function decodeSplat(blob,{signal,fileName='scene.spz'}={}){
  const scope=materializationScope({signal});let mesh,pending,released=false;const release=()=>{if(mesh&&!released){released=true;mesh.dispose();}};
  try{const header=await scope.wait(()=>inspectSplatHeader(blob,{signal:scope.signal}));const {SplatMesh,SplatFileType}=await scope.wait(loadSpark);const fileBytes=await scope.wait(()=>blob.arrayBuffer());mesh=new SplatMesh({fileBytes,fileName,fileType:SplatFileType.SPZ,lod:false,raycastable:true});
    const value=mesh;pending=value.initialized;await scope.wait(()=>pending,{disposeLate:release});scope.check();
    if(value.splats?.getNumSplats()!==header.count)throw Error('SPZ 解码数量与文件头不一致');
    const bounds=value.getBoundingBox();if(bounds.isEmpty()||[...bounds.min.toArray(),...bounds.max.toArray()].some(n=>!Number.isFinite(n)))throw Error('高斯数据没有有效显示边界');
    const framingBounds=splatFramingBounds(value,bounds);pending=buildSplatLod(value);await scope.wait(()=>pending,{disposeLate:release});scope.check();
    value.userData.worldRenderableKind='gaussian-splat';return {mesh:value,header,bounds,framingBounds};
  }catch(error){if(mesh)(pending||mesh.initialized).then(release,release);throw error;}finally{scope.close();}
}
// Far environment splats should remain rendered without pushing initial object
// framing hundreds of metres away. A bounded deterministic center sample only
// supplies a camera hint; full bounds and every Gaussian remain authoritative.
export function splatFramingBounds(mesh,fullBounds){
  const axes=[[],[],[]],stride=Math.max(1,Math.ceil(mesh.splats.getNumSplats()/32768));
  mesh.forEachSplat((index,center)=>{if(index%stride)return;axes[0].push(center.x);axes[1].push(center.y);axes[2].push(center.z);});
  if(axes[0].length<20)return fullBounds.clone();
  const min=[],max=[];for(const values of axes){values.sort((a,b)=>a-b);min.push(values[Math.floor((values.length-1)*.1)]);max.push(values[Math.ceil((values.length-1)*.9)]);}
  const central=new THREE.Box3(new THREE.Vector3(...min),new THREE.Vector3(...max)),size=central.getSize(new THREE.Vector3()),full=fullBounds.getSize(new THREE.Vector3());
  if(Math.max(...full.toArray())<=Math.max(...size.toArray(),.001)*4)return fullBounds.clone();
  central.expandByVector(size.multiplyScalar(.15));return central;
}
export function splatAxisScale(descriptor){return new THREE.Vector3(1,descriptor.coordinateSystem==='marble_raw_opencv'?-1:1,descriptor.coordinateSystem==='marble_raw_opencv'?-1:1);}
export function splatProxy(descriptor,{name='高斯场景',id}={}){
  validateSplatDescriptor(descriptor);assertLocalSplatSource(descriptor.url);const proxy=new THREE.Group();proxy.name=name;proxy.userData.worldSplat=structuredClone(descriptor);proxy.userData.studioId=id||crypto.randomUUID();proxy.userData.worldRenderableKind='gaussian-splat';if(Number.isFinite(descriptor.metricScaleFactor)&&descriptor.metricScaleFactor>0)proxy.scale.setScalar(descriptor.metricScaleFactor);if(descriptor.coordinateSystem==='marble_raw_opencv'&&Number.isFinite(descriptor.groundPlaneOffset))proxy.position.y=descriptor.groundPlaneOffset;return proxy;
}
export function splatObjects(root){const values=[];root.traverse(object=>{if(object.userData?.worldSplat){validateSplatDescriptor(object.userData.worldSplat);values.push(object);}});return values;}
export function spatialBounds(root,target=new THREE.Box3(),{framing=false}={}){
  target.setFromObject(root);root.updateWorldMatrix(true,true);for(const object of splatObjects(root)){const descriptor=object.userData.worldSplat,[min,max]=framing&&descriptor.framingBounds?descriptor.framingBounds:descriptor.bounds;target.union(new THREE.Box3(new THREE.Vector3(...min),new THREE.Vector3(...max)).applyMatrix4(object.matrixWorld));}return target;
}

// Authoritative documents contain plain Groups and local SPZ descriptors. GPU
// objects belong to one render context, never JSON/GLTF/SkeletonUtils history.
export class SplatContext {
  constructor(renderer,scene,{onDirty=()=>{},onError=()=>{}}={}){this.renderer=renderer;this.scene=scene;this.onDirty=onDirty;this.onError=onError;this.layer=new THREE.Group();this.layer.name='Gaussian render context';this.layer.visible=false;scene.add(this.layer);this.entries=new Map();this.retirements=new Set();this.disposed=false;this.abort=new AbortController();this.preparing=null;this.serial=Promise.resolve();}
  async prepare(root){
    await this.serial;if(this.disposed)throw Error('高斯渲染上下文已关闭');const proxies=splatObjects(root),total=proxies.reduce((sum,o)=>sum+o.userData.worldSplat.count,0);if(total>splatLimits.sceneSplats)throw Object.assign(Error('片场超过 250 万高斯总预算'),{code:'world_splat_budget'});
    const active=new Set(proxies);for(const [proxy,mesh] of this.entries)if(!active.has(proxy)){mesh.removeFromParent();this.entries.delete(proxy);await this.retire(mesh);}
    if(!proxies.length){this.releaseEmpty();return;}
    const {SparkRenderer}=await loadSpark();if(this.disposed)throw Error('高斯渲染上下文已关闭');
    if(!this.spark){this.spark=new SparkRenderer({renderer:this.renderer,enableLod:true,lodSplatCount:splatLodPolicy.targetSplats,lodRenderScale:splatLodPolicy.minPixelSize,lodRaycast:false,lodCleanupTimeoutMs:0,autoUpdate:false,minSortIntervalMs:0,onDirty:()=>{if(!this.disposed)this.onDirty();}});this.lod=new SplatLodController(this.spark);this.spark.layers.enableAll();this.layer.add(this.spark);}
    for(const proxy of proxies){if(this.entries.has(proxy))continue;const blob=await readLocalSplat(proxy.userData.worldSplat.url,{signal:this.abort.signal});const result=await decodeSplat(blob,{signal:this.abort.signal});if(this.disposed||result.header.count!==proxy.userData.worldSplat.count){result.mesh.dispose();throw Error('高斯渲染已关闭或源文件数量已改变');}this.entries.set(proxy,result.mesh);this.layer.add(result.mesh);}
    this.sync();
  }
  retire(mesh){const lod=this.lod,task=this.serial.then(async()=>{try{await lod?.release(mesh);}finally{mesh.dispose();}});this.retirements.add(task);task.catch(this.onError).finally(()=>this.retirements.delete(task));return task;}
  rebind(root){const objects=new Map(splatObjects(root).map(object=>[object.uuid,object]));const entries=new Map();for(const [proxy,mesh] of this.entries){const next=objects.get(proxy.uuid);if(next)entries.set(next,mesh);else{mesh.removeFromParent();void this.retire(mesh);}}this.entries=entries;this.lastKey=null;this.offscreenSettled=null;this.releaseEmpty();this.sync();}
  prune(root){const objects=new Set(splatObjects(root));for(const [proxy,mesh] of this.entries)if(!objects.has(proxy)){mesh.removeFromParent();this.entries.delete(proxy);void this.retire(mesh);}this.lastKey=null;this.offscreenSettled=null;this.releaseEmpty();}
  releaseEmpty(){if(this.entries.size||!this.spark)return;void this.serial.then(async()=>{await Promise.allSettled([...this.retirements]);if(this.entries.size||!this.spark)return;this.lod?.disposeTextures();this.spark.removeFromParent();this.spark.dispose();this.spark=null;this.lod=null;}).catch(this.onError);}
  readLod(){return this.lod?.read([...this.entries.values()])||{...splatLodPolicy,selectedCount:0,drawCount:0,activeCount:0,sources:[],workerTrees:0,indexTextures:0};}
  sync(){for(const [proxy,mesh] of this.entries){proxy.updateWorldMatrix(true,false);mesh.matrixAutoUpdate=false;mesh.layers.mask=proxy.layers.mask;mesh.matrix.copy(proxy.matrixWorld).scale(splatAxisScale(proxy.userData.worldSplat));mesh.matrixWorldNeedsUpdate=true;let visible=true;for(let node=proxy;node;node=node.parent)visible=visible&&node.visible;mesh.visible=visible;}}
  render(root,camera,draw){
    const visible=this.layer.visible;this.layer.visible=this.entries.size>0;this.sync();
    try{if(this.spark&&this.entries.size)this.enqueue(camera).catch(this.onError);return draw();}finally{this.layer.visible=visible;}
  }
  enqueue(camera){
    // A second update must never race Spark's accumulator/sort ownership.
    if(this.preparing)return this.preparing;this.sync();const view=camera.clone();camera.updateWorldMatrix(true,false);camera.matrixWorld.decompose(view.position,view.quaternion,view.scale);view.updateMatrixWorld(true);
    const key=this.viewKey(view,'viewport',this.renderer.domElement.width,this.renderer.domElement.height);if(key===this.lastKey)return this.serial;this.offscreenSettled=null;
    // Spark frameUpdates hidden generators too. Its accumulation root must be
    // this context's layer so another view cannot overwrite our raycast state.
    this.preparing=this.serial.then(async()=>{if(this.disposed||!this.spark)return;this.sync();this.renderer.getDrawingBufferSize(this.spark.renderSize);await this.lod.select(view,[...this.entries.values()]);if(this.disposed)return;const visible=this.layer.visible;let update;try{this.layer.visible=true;update=this.spark.update({scene:this.layer,camera:view});}finally{this.layer.visible=visible;}await update;this.lastKey=key;if(!this.disposed)this.onDirty();}).finally(()=>{this.preparing=null;});this.serial=this.preparing.catch(()=>{});return this.preparing;
  }
  async settle(root,camera){if(!camera?.isCamera)throw Error('高斯拍摄需要有效镜头');await this.prepare(root);if(!this.spark)return;await this.serial;await this.enqueue(camera);if(this.disposed)throw Error('高斯渲染上下文已关闭');}
  viewKey(camera,mode,width,height){camera.updateWorldMatrix(true,false);return JSON.stringify([mode,width,height,camera.matrixWorld.elements,camera.projectionMatrix.elements,camera.fov,camera.aspect,camera.zoom,camera.near,camera.far,camera.layers.mask,[...this.entries].map(([proxy,mesh])=>[proxy.uuid,mesh.uuid,mesh.matrix.elements,mesh.visible,mesh.layers.mask])]);}
  checkOffscreen(camera,{width,height,signal,assertCurrent}={}){if(!camera?.isCamera)throw Error('高斯拍摄需要有效镜头');if(!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1)throw Error('高斯离屏尺寸需要正整数');if(this.disposed)throw Error('高斯渲染上下文已关闭');if(signal?.aborted)throw signal.reason||new DOMException('高斯离屏渲染已取消','AbortError');if(assertCurrent?.()===false)throw Error('高斯离屏渲染身份已改变');}
  offscreenKey(root,camera,options){this.checkOffscreen(camera,options);const proxies=splatObjects(root);if(proxies.length!==this.entries.size||proxies.some(proxy=>!this.entries.has(proxy)))throw Error('高斯离屏源场景已改变');this.sync();return this.viewKey(camera,'offscreen',options.width,options.height);}
  async settleOffscreen(root,camera,options={}){
    this.checkOffscreen(camera,options);await this.prepare(root);this.checkOffscreen(camera,options);await this.serial;this.checkOffscreen(camera,options);
    const key=this.offscreenKey(root,camera,options);this.offscreenSettled=null;
    if(!this.spark||!this.entries.size||key===this.lastKey){this.offscreenSettled={root,key};return;}
    const view=camera.clone();camera.matrixWorld.decompose(view.position,view.quaternion,view.scale);view.updateMatrixWorld(true);
    // Explicit dimensions must reach native LOD before accumulation/sort. The
    // host holds the render lease; ordinary viewport requests remain coalesced.
    this.preparing=this.serial.then(async()=>{
      if(this.offscreenKey(root,camera,options)!==key)throw Error('高斯离屏镜头或源场景已改变');
      const spark=this.spark,size=spark.renderSize.clone();
      try{
        spark.renderSize.set(options.width,options.height);await this.lod.select(view,[...this.entries.values()]);
        if(this.offscreenKey(root,camera,options)!==key)throw Error('高斯离屏镜头或源场景已改变');
        const visible=this.layer.visible;let update;try{this.layer.visible=true;update=spark.update({scene:this.layer,camera:view});}finally{this.layer.visible=visible;}
        await update;if(this.offscreenKey(root,camera,options)!==key)throw Error('高斯离屏镜头或源场景已改变');
        this.lastKey=key;this.offscreenSettled={root,key};
      }catch(error){this.lastKey=null;this.offscreenSettled=null;throw error;}finally{spark.renderSize.copy(size);}
    }).finally(()=>{this.preparing=null;});this.serial=this.preparing.catch(()=>{});return this.preparing;
  }
  renderSettled(root,camera,draw,options={}){
    const key=this.offscreenKey(root,camera,options);
    if(this.preparing||this.offscreenSettled?.root!==root||this.offscreenSettled.key!==key)throw Error('高斯离屏镜头尚未完成排序');
    if(typeof draw!=='function')throw Error('高斯离屏渲染需要同步 draw');
    const visible=this.layer.visible,spark=this.spark,autoUpdate=spark?.autoUpdate;this.layer.visible=this.entries.size>0;if(spark)spark.autoUpdate=false;
    try{const result=draw();if(result?.then)throw Error('高斯离屏 draw 必须同步完成');return result;}finally{this.layer.visible=visible;if(spark)spark.autoUpdate=autoUpdate;}
  }
  pick(camera,u,v,{root}={}){
    if(this.disposed||!this.entries.size||!camera?.isCamera)return null;
    this.sync();const ray=new THREE.Raycaster();ray.layers.mask=camera.layers.mask;ray.setFromCamera(new THREE.Vector2(u*2-1,1-v*2),camera);const hits=[];
    for(const [proxy,mesh] of this.entries){
      // The GPU layer is deliberately hidden between context renders. Visibility
      // comes from the authoritative proxy tree, not that implementation layer.
      if(!mesh.visible||!camera.layers.test(proxy.layers))continue;if(root){let belongs=false;for(let node=proxy;node;node=node.parent)if(node===root){belongs=true;break;}if(!belongs)continue;}
      mesh.updateWorldMatrix(true,false);
      // Official Spark returns world-ray distances/points after its native
      // packed/ext Gaussian intersection; never approximate with proxy bounds.
      for(const found of ray.intersectObject(mesh,false)){if(!Number.isFinite(found.distance)||found.distance<0||!found.point)continue;const point=found.point.clone(),clip=point.clone().project(camera),depth=clip.z*.5+.5;if(!Number.isFinite(depth)||depth<0||depth>1)continue;hits.push({proxy,distance:found.distance,point,depth});break;}
    }
    hits.sort((a,b)=>a.distance-b.distance||String(a.proxy.userData.studioId||a.proxy.uuid).localeCompare(String(b.proxy.userData.studioId||b.proxy.uuid)));return hits[0]||null;
  }
  dispose(){if(this.disposed)return this.disposal;this.disposed=true;this.abort.abort(new DOMException('高斯渲染已取消','AbortError'));this.layer.removeFromParent();this.disposal=this.serial.then(async()=>{await Promise.allSettled([...this.retirements]);this.lod?.disposeTextures();for(const mesh of this.entries.values())mesh.dispose();this.entries.clear();this.spark?.dispose();this.spark=null;this.lod=null;});return this.disposal;}
}
