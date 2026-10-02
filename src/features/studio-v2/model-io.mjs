import {exportEasing,importEasing} from './motion-easing-io.mjs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {modelResourceLifecycle} from './model-resource-lifecycle.mjs';
export const maxBytes=12*1024*1024;
const fail=(message,code)=>Object.assign(new Error(message),{code});
const dataUrl=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});
function loader(){const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(!/^(data:|blob:|\/node_modules\/three\/)/.test(url))throw fail('模型引用了未提供的关联资源。','resources');return url;});const draco=new DRACOLoader(manager).setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/');return {gltf:new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder),draco};}
export async function inspectModel(file,resources=[],{signal}={}){
  const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('模型读取已取消','AbortError');};check();
  if(!file||!/\.(gltf|glb)$/i.test(file.name))throw fail('请选择一个 .gltf 或 .glb 模型文件。','format');
  if(file.size+resources.reduce((sum,f)=>sum+f.size,0)>maxBytes)throw fail('文件或合并后的场景超过 12 MiB，请精简模型或纹理后重试。','size');
  let data=await file.arrayBuffer(),json;check();
  try{
    if(/\.glb$/i.test(file.name)){
      const view=new DataView(data);if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==data.byteLength||view.getUint32(16,true)!==0x4e4f534a)throw Error();
      json=JSON.parse(new TextDecoder().decode(data.slice(20,20+view.getUint32(12,true))));
    }else json=JSON.parse(new TextDecoder().decode(data));
    if(json.asset?.version!=='2.0'||!Array.isArray(json.scenes))throw Error();
  }catch{throw fail('文件不是有效的 glTF 2.0 / GLB，或包含无效的数据引用。请检查后重试。','invalid');}
  const external=[...(json.buffers||[]),...(json.images||[])].filter(r=>r.uri&&!r.uri.startsWith('data:'));
  const missing=[];
  for(const resource of external){let name;try{name=decodeURIComponent(resource.uri).replace(/^\.\//,'');}catch{name=resource.uri;}const match=resources.find(f=>(f.webkitRelativePath||f.name)===name||f.name===name);if(!match)missing.push(name);else resource.uri=await dataUrl(match);}
  if(missing.length)throw fail('缺少以下关联资源，请补充文件，或从建模软件导出内嵌资源的 GLB。\n'+missing.join('\n'),'resources');
  if(external.length||/\.gltf$/i.test(file.name)){
    // A GLB binary buffer remains embedded when external image resources are substituted.
    if(/\.glb$/i.test(file.name)&&json.buffers?.some(b=>!b.uri)){const view=new DataView(data);const offset=20+view.getUint32(12,true);if(offset+8>data.byteLength)throw fail('GLB 缺少二进制数据。','invalid');const binary=data.slice(offset+8,offset+8+view.getUint32(offset,true));for(const buffer of json.buffers)if(!buffer.uri)buffer.uri=await dataUrl(new Blob([binary],{type:'application/octet-stream'}));}
    data=JSON.stringify(json);
  }
  check();const {gltf,draco}=loader(),lifecycle=modelResourceLifecycle();gltf.register(parser=>lifecycle.plugin(parser));let loaded,rejectAbort,decoderDisposed=false;
  const disposeDecoder=()=>{if(!decoderDisposed){decoderDisposed=true;draco.dispose();}};
  const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
  const onAbort=()=>{lifecycle.fail();disposeDecoder();rejectAbort(signal.reason??new DOMException('模型读取已取消','AbortError'));};
  signal?.addEventListener('abort',onAbort,{once:true});
  try{check();loaded=await Promise.race([gltf.parseAsync(data,''),interrupted]);check();}
  catch(error){lifecycle.fail();if(signal?.aborted)throw signal.reason??error;throw fail('模型无法加载：'+error.message,'invalid');}
  finally{signal?.removeEventListener('abort',onAbort);disposeDecoder();}
  lifecycle.transfer();
  try {
  // Bind by UUID before restoring names: GLTFLoader disambiguates duplicate rig names.
  for(const clip of loaded.animations)for(const track of clip.tracks){const parsed=THREE.PropertyBinding.parseTrackName(track.name);const object=loaded.scenes.map(scene=>THREE.PropertyBinding.findNode(scene,parsed.nodeName)).find(Boolean);if(object)track.name=object.uuid+'.'+parsed.propertyName;}
  importEasing(loaded);
  for(const scene of loaded.scenes)scene.traverse(object=>{const originalName=object.userData.studioDisplayName??json.nodes?.[loaded.parser.associations.get(object)?.nodes]?.name;if(originalName!==undefined)object.name=originalName;});
  return {loaded,scenes:loaded.scenes.map((scene,index)=>({index,name:scene.name||'场景 '+(index+1)})),defaultScene:Math.max(0,loaded.scenes.indexOf(loaded.scene)),file};
  }catch(error){disposeLoadedModel(loaded);throw error;}
}
export async function exportGlb(scene,animations=[]){scene.traverse(object=>{object.userData.studioDisplayName=object.name;});const {sampled,plugin}=exportEasing(scene,animations);const data=await new GLTFExporter().register(plugin).parseAsync(scene,{binary:true,animations:sampled,onlyVisible:false});if(data.byteLength>maxBytes)throw fail('文件或合并后的场景超过 12 MiB，请精简模型或纹理后重试。','size');return new Blob([data],{type:'model/gltf-binary'});}
export async function loadSaved(url){const resolved=await window.LocalAssets.url(url),response=await fetch(resolved);if(!response.ok)throw Error('本地模型读取失败');const blob=await response.blob();return (await inspectModel(new File([blob],'scene.glb'))).loaded;}
export function primitive(kind,name){const geometry=kind==='cube'?new THREE.BoxGeometry(1,1,1):kind==='sphere'?new THREE.SphereGeometry(.5,32,16):kind==='cylinder'?new THREE.CylinderGeometry(.5,.5,1,32):kind==='cone'?new THREE.ConeGeometry(.5,1,32):new THREE.ConeGeometry(Math.SQRT1_2,1,4);if(kind==='pyramid')geometry.rotateY(Math.PI/4);const object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:new THREE.Color(.8,.8,.8),roughness:.8}));object.name=name;object.position.y=.5;object.castShadow=object.receiveShadow=true;return object;}
export function disposeModel(root,{retain}={}){const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const mat of o.material?Array.isArray(o.material)?o.material:[o.material]:[]){materials.add(mat);for(const value of Object.values(mat))if(value?.isTexture)textures.add(value);}});if(retain)retain.traverse(o=>{geometries.delete(o.geometry);for(const mat of o.material?Array.isArray(o.material)?o.material:[o.material]:[]){materials.delete(mat);for(const value of Object.values(mat))if(value?.isTexture)textures.delete(value);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}
export function disposeLoadedModel(loaded){const scenes=new Set([loaded.scene,...(loaded.scenes||[])].filter(Boolean));disposeModel({traverse:callback=>{for(const scene of scenes)scene.traverse(callback);}});}
