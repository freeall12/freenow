import * as THREE from 'three';
import {inspectSplatHeader,splatLimits,validateSplatDescriptor} from './splat-contract.mjs';
import {materializationScope,readModelBlob} from './materialization.mjs';
import {isStaticAssetRef} from '../local-resource-migration/index-format.mjs';
import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
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
  const scope=materializationScope({signal});let mesh,released=false;const release=()=>{if(mesh&&!released){released=true;mesh.dispose();}};
  try{const header=await scope.wait(()=>inspectSplatHeader(blob,{signal:scope.signal}));const {SplatMesh,SplatFileType}=await scope.wait(loadSpark);const fileBytes=await scope.wait(()=>blob.arrayBuffer());mesh=new SplatMesh({fileBytes,fileName,fileType:SplatFileType.SPZ,lod:false,raycastable:true});
    const value=mesh;await scope.wait(()=>value.initialized,{disposeLate:release});scope.check();
    if(value.splats?.getNumSplats()!==header.count)throw Error('SPZ 解码数量与文件头不一致');
    const bounds=value.getBoundingBox();if(bounds.isEmpty()||[...bounds.min.toArray(),...bounds.max.toArray()].some(n=>!Number.isFinite(n)))throw Error('高斯数据没有有效显示边界');
    value.userData.worldRenderableKind='gaussian-splat';return {mesh:value,header,bounds,framingBounds:splatFramingBounds(value,bounds)};
  }catch(error){if(mesh)mesh.initialized.then(release,release);throw error;}finally{scope.close();}
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
  constructor(renderer,scene,{onDirty=()=>{},onError=()=>{}}={}){this.renderer=renderer;this.scene=scene;this.onDirty=onDirty;this.onError=onError;this.layer=new THREE.Group();this.layer.name='Gaussian render context';this.layer.visible=false;scene.add(this.layer);this.entries=new Map();this.disposed=false;this.abort=new AbortController();this.preparing=null;this.serial=Promise.resolve();}
  async prepare(root){
    await this.serial;if(this.disposed)throw Error('高斯渲染上下文已关闭');const proxies=splatObjects(root),total=proxies.reduce((sum,o)=>sum+o.userData.worldSplat.count,0);if(total>splatLimits.sceneSplats)throw Object.assign(Error('片场超过 250 万高斯总预算'),{code:'world_splat_budget'});
    const active=new Set(proxies);for(const [proxy,mesh] of this.entries)if(!active.has(proxy)){mesh.removeFromParent();mesh.dispose();this.entries.delete(proxy);}
    if(!proxies.length){this.releaseEmpty();return;}
    const {SparkRenderer}=await loadSpark();if(this.disposed)throw Error('高斯渲染上下文已关闭');
    if(!this.spark){this.spark=new SparkRenderer({renderer:this.renderer,enableLod:false,autoUpdate:false,minSortIntervalMs:0,onDirty:()=>{if(!this.disposed)this.onDirty();}});this.spark.layers.enableAll();this.layer.add(this.spark);}
    for(const proxy of proxies){if(this.entries.has(proxy))continue;const blob=await readLocalSplat(proxy.userData.worldSplat.url,{signal:this.abort.signal});const result=await decodeSplat(blob,{signal:this.abort.signal});if(this.disposed||result.header.count!==proxy.userData.worldSplat.count){result.mesh.dispose();throw Error('高斯渲染已关闭或源文件数量已改变');}this.entries.set(proxy,result.mesh);this.layer.add(result.mesh);}
    this.sync();
  }
  rebind(root){const objects=new Map(splatObjects(root).map(object=>[object.uuid,object]));const entries=new Map();for(const [proxy,mesh] of this.entries){const next=objects.get(proxy.uuid);if(next)entries.set(next,mesh);else{mesh.removeFromParent();void this.serial.finally(()=>mesh.dispose());}}this.entries=entries;this.lastKey=null;this.releaseEmpty();this.sync();}
  prune(root){const objects=new Set(splatObjects(root));for(const [proxy,mesh] of this.entries)if(!objects.has(proxy)){mesh.removeFromParent();this.entries.delete(proxy);void this.serial.finally(()=>mesh.dispose());}this.lastKey=null;this.releaseEmpty();}
  releaseEmpty(){if(this.entries.size||!this.spark)return;void this.serial.finally(()=>{if(this.entries.size||!this.spark)return;this.spark.removeFromParent();this.spark.dispose();this.spark=null;});}
  sync(){for(const [proxy,mesh] of this.entries){proxy.updateWorldMatrix(true,false);mesh.matrixAutoUpdate=false;mesh.layers.mask=proxy.layers.mask;mesh.matrix.copy(proxy.matrixWorld).scale(splatAxisScale(proxy.userData.worldSplat));mesh.matrixWorldNeedsUpdate=true;let visible=true;for(let node=proxy;node;node=node.parent)visible=visible&&node.visible;mesh.visible=visible;}}
  render(root,camera,draw){
    const visible=this.layer.visible;this.layer.visible=this.entries.size>0;this.sync();
    try{if(this.spark&&this.entries.size)this.enqueue(camera).catch(this.onError);return draw();}finally{this.layer.visible=visible;}
  }
  enqueue(camera){
    // A second update must never race Spark's accumulator/sort ownership.
    if(this.preparing)return this.preparing;this.sync();const view=camera.clone();camera.updateWorldMatrix(true,false);camera.matrixWorld.decompose(view.position,view.quaternion,view.scale);view.updateMatrixWorld(true);
    const key=JSON.stringify([view.matrixWorld.elements,view.projectionMatrix.elements,view.layers.mask,this.renderer.domElement.width,this.renderer.domElement.height,[...this.entries].map(([proxy,mesh])=>[proxy.uuid,mesh.matrix.elements,mesh.visible,mesh.layers.mask])]);if(key===this.lastKey)return this.serial;
    this.preparing=this.serial.then(async()=>{if(this.disposed)return;this.sync();this.renderer.getDrawingBufferSize(this.spark.renderSize);const visible=this.layer.visible;let update;try{this.layer.visible=true;update=this.spark.update({scene:this.scene,camera:view});}finally{this.layer.visible=visible;}await update;this.lastKey=key;if(!this.disposed)this.onDirty();}).finally(()=>{this.preparing=null;});this.serial=this.preparing.catch(()=>{});return this.preparing;
  }
  async settle(root,camera){if(!camera?.isCamera)throw Error('高斯拍摄需要有效镜头');await this.prepare(root);if(!this.spark)return;await this.serial;await this.enqueue(camera);if(this.disposed)throw Error('高斯渲染上下文已关闭');}
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
  dispose(){if(this.disposed)return this.disposal;this.disposed=true;this.abort.abort(new DOMException('高斯渲染已取消','AbortError'));this.layer.removeFromParent();this.disposal=this.serial.finally(()=>{for(const mesh of this.entries.values())mesh.dispose();this.entries.clear();this.spark?.dispose();this.spark=null;});return this.disposal;}
}
