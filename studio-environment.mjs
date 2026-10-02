import * as THREE from 'three';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {environmentPresets} from './studio-environment-data.mjs';

export function roomPattern(style,x,y){
 const alternate=(x<32)!==(y<32);
 if(style!=='calibration')return alternate?0xffffff:0x707070;
 const px=x%32,py=y%32,offset=alternate?6:9;
 const marker=(px>=offset&&px<offset+2&&py>=offset&&py<offset+8)||(py>=offset&&py<offset+2&&px>=offset&&px<offset+8);
 return marker?(alternate?0x5f5f5f:0xffffff):(alternate?0xffffff:0x5f5f5f);
}
export function roomTexture(room,width,height){
 const data=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const color=roomPattern(room.style,x,y),i=(y*64+x)*4;data[i]=color>>16;data[i+1]=color>>8&255;data[i+2]=color&255;data[i+3]=255;}
 const texture=new THREE.DataTexture(data,64,64);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.anisotropy=8;texture.colorSpace=THREE.SRGBColorSpace;texture.repeat.set(Math.max(1,width/(room.spacing*2)),Math.max(1,height/(room.spacing*2)));texture.needsUpdate=true;return texture;
}
export function buildRoomGeometry(room,ground){
 const group=new THREE.Group(),r=room,g=ground;
 const planes=[{w:r.width,h:r.depth,p:[0,g.y,0],rot:[-Math.PI/2,0,0]},{w:r.width,h:r.depth,p:[0,g.y+r.height,0],rot:[Math.PI/2,0,0]},{w:r.width,h:r.height,p:[0,g.y+r.height/2,-r.depth/2],rot:[0,0,0]},{w:r.width,h:r.height,p:[0,g.y+r.height/2,r.depth/2],rot:[0,Math.PI,0]},{w:r.depth,h:r.height,p:[-r.width/2,g.y+r.height/2,0],rot:[0,Math.PI/2,0]},{w:r.depth,h:r.height,p:[r.width/2,g.y+r.height/2,0],rot:[0,-Math.PI/2,0]}];
 for(const p of planes){const map=r.guides&&r.style!=='white'?roomTexture(r,p.w,p.h):null,material=new THREE.MeshStandardMaterial({color:r.style==='white'||map?0xffffff:0x787878,roughness:r.style==='white'?.82:.9,metalness:0,map,side:THREE.FrontSide}),mesh=new THREE.Mesh(new THREE.PlaneGeometry(p.w,p.h),material);mesh.position.fromArray(p.p);mesh.rotation.set(...p.rot);mesh.receiveShadow=true;group.add(mesh);}
 if(r.guides&&r.style!=='white'&&r.lineMarkers)addRoomGuides(group,r,g.y);
 return group;
}
function addRoomGuides(group,r,groundY){
 const colors={x:0xff3030,y:0x22d66f,z:0x2f6dff},inset=.004,edgeRadius=.035,radius=edgeRadius/4;
 const materials=Object.fromEntries(Object.entries(colors).map(([a,color])=>[a,new THREE.MeshBasicMaterial({color,side:THREE.FrontSide,depthWrite:false,toneMapped:false})]));
 const guides=new THREE.Group();guides.name='room-guides';group.add(guides);
 const cylinder=(axis,center,length,thickness,order)=>{const mesh=new THREE.Mesh(new THREE.CylinderGeometry(thickness,thickness,length,order===2?24:12),materials[axis]);mesh.position.fromArray(center);if(axis==='x')mesh.rotation.z=-Math.PI/2;if(axis==='z')mesh.rotation.x=Math.PI/2;mesh.renderOrder=order;mesh.raycast=()=>{};mesh.userData.roomGuide=true;guides.add(mesh);};
 const x=r.width/2-inset-edgeRadius,z=r.depth/2-inset-edgeRadius,low=groundY+inset+edgeRadius,high=groundY+r.height-inset-edgeRadius;
 for(const y of [low,high]){for(const zz of [-z,z])cylinder('x',[0,y,zz],r.width-inset*2,edgeRadius,2);for(const xx of [-x,x])cylinder('z',[xx,y,0],r.depth-inset*2,edgeRadius,2);}for(const xx of [-x,x])for(const zz of [-z,z])cylinder('y',[xx,(low+high)/2,zz],r.height-inset*2,edgeRadius,2);
 const centered=size=>{const count=Math.floor((size/2-edgeRadius*2)/r.spacing);return Array.from({length:Math.max(0,count*2+1)},(_,i)=>Math.round((i-count)*r.spacing*1000)/1000);},xs=centered(r.width),zs=centered(r.depth),ys=[];for(let i=Math.ceil(edgeRadius*2/r.spacing);i<=Math.floor((r.height-edgeRadius*2)/r.spacing);i++)ys.push(i*r.spacing+groundY);
 // Instancing keeps large rooms and 0.25 m spacing practical without thousands of draw calls.
 const matrices={x:[],y:[],z:[]};const add=(axis,p,length)=>{const q=new THREE.Quaternion();if(axis==='x')q.setFromAxisAngle(new THREE.Vector3(0,0,1),-Math.PI/2);if(axis==='z')q.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);matrices[axis].push(new THREE.Matrix4().compose(new THREE.Vector3(...p),q,new THREE.Vector3(1,length,1)));};
 const floor=groundY+inset+radius,ceiling=groundY+r.height-inset-radius,left=-r.width/2+inset+radius,right=-left,back=-r.depth/2+inset+radius,front=-back;
 for(const zz of zs)for(const y of [floor,ceiling])add('x',[0,y,zz],r.width-.14);
 for(const xx of xs)for(const y of [floor,ceiling])add('z',[xx,y,0],r.depth-.14);
 for(const y of ys){for(const zz of [back,front])add('x',[0,y,zz],r.width-.14);for(const xx of [left,right])add('z',[xx,y,0],r.depth-.14);}
 for(const xx of xs)for(const zz of [back,front])add('y',[xx,groundY+r.height/2,zz],r.height-.14);
 for(const zz of zs)for(const xx of [left,right])add('y',[xx,groundY+r.height/2,zz],r.height-.14);
 for(const axis of ['x','y','z']){const mesh=new THREE.InstancedMesh(new THREE.CylinderGeometry(radius,radius,1,12),materials[axis],matrices[axis].length);matrices[axis].forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.renderOrder=1;mesh.raycast=()=>{};mesh.userData.roomGuide=true;guides.add(mesh);}
}

export class EnvironmentTextures {
 constructor(resolve,load){this.resolve=resolve;this.load=load;this.entries=new Map();this.disposed=false;}
 get(resource){const key=resource.url+'|'+resource.format;if(!this.entries.has(key)){const promise=Promise.resolve().then(()=>this.resolve(resource.url)).then(url=>this.load(url,resource.format)).then(texture=>{if(this.disposed){texture.dispose();throw Error('片场已关闭');}return texture;}).catch(error=>{this.entries.delete(key);throw error;});this.entries.set(key,promise);}return this.entries.get(key);}
 dispose(){this.disposed=true;for(const promise of this.entries.values())promise.then(texture=>texture.dispose(),()=>{});this.entries.clear();}
}
export function installEnvironment(Studio,{loadModel,cloneSkeleton}){
 const renderBase=Studio.prototype.environment,closeBase=Studio.prototype.close;
 Object.assign(Studio.prototype,{
  buildRoom(){return buildRoomGeometry(this.data.room,this.data.ground);},
  environment(){renderBase.call(this);if(!this.data.ground.room)this.room=null;if(this.data.ground.sceneAsset||this.data.ground.hidden&&!this.data.ground.room){this.ground.visible=false;this.grid.visible=false;this.fineGrid.visible=false;}this.updateEnvironmentTextures();this.updateWorldScene();this.renderEnvironmentPanel?.();},
  async updateWorldScene(){
   const resource=this.data.ground.sceneAsset,url=resource?.url||null;if(this.worldSceneUrl===url)return;this.worldSceneUrl=url;const sequence=this.worldSceneSequence=(this.worldSceneSequence||0)+1;if(this.worldScene){this.scene.remove(this.worldScene);this.disposeObject({root:this.worldScene});this.worldScene=null;}if(!url)return;
   try{const gltf=await loadModel(url);if(this.closed||this.worldSceneSequence!==sequence)return;const root=cloneSkeleton(gltf.scene);root.traverse(o=>{if(o.isMesh){o.geometry=o.geometry.clone();o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();o.receiveShadow=true;o.castShadow=true;}});root.name='environment-world-scene';this.worldScene=root;this.scene.add(root);}
   catch(error){if(!this.closed&&this.worldSceneSequence===sequence){this.worldSceneUrl=null;this.notify('场景加载失败：'+error.message);}}
  },
  textureStore(){return this.environmentTextures??=new EnvironmentTextures(url=>window.LocalAssets.url(url),async(url,format)=>{const texture=await (format==='hdr'?new RGBELoader():new THREE.TextureLoader()).loadAsync(url);texture.mapping=THREE.EquirectangularReflectionMapping;if(format!=='hdr')texture.colorSpace=THREE.SRGBColorSpace;return texture;});},
  async updateEnvironmentTextures(){
   const sequence=this.environmentSequence=(this.environmentSequence||0)+1,e=this.data.environment,preset=environmentPresets.find(p=>p.id===(e.preset||'studio-soft'))||environmentPresets[0],lighting=e.hdri||{url:preset.url,format:'hdr',name:preset.label},panorama=e.panorama;
   this.scene.backgroundRotation.y=THREE.MathUtils.degToRad(e.background==='lighting'?e.azimuth:e.panoramaRotation||0);
   if(e.background==='none')this.scene.background=new THREE.Color('#060606');
   try{const [hdr,sky]=await Promise.all([this.textureStore().get(lighting),e.background==='panorama'&&panorama?this.textureStore().get(panorama):null]);if(this.closed||sequence!==this.environmentSequence)return;this.hdr=hdr;this.scene.environment=hdr;this.scene.environmentRotation.y=THREE.MathUtils.degToRad(e.azimuth);this.scene.environmentIntensity=e.intensity??1;this.scene.background=e.background==='lighting'?hdr:e.background==='panorama'&&sky?sky:new THREE.Color('#060606');this.scene.backgroundRotation.y=THREE.MathUtils.degToRad(e.background==='lighting'?e.azimuth:e.panoramaRotation||0);this.environmentLoadError=null;}
   catch(error){if(!this.closed&&sequence===this.environmentSequence){this.environmentLoadError=error.message;this.notify('环境资源加载失败：'+error.message);}}
  },
  async setEnvironment(change){this.remember();change();this.environment();this.persist();this.renderEnvironmentPanel?.();await this.updateEnvironmentTextures();},
  async importEnvironment(kind){const input=document.createElement('input');input.type='file';input.accept=kind==='lighting'?'.hdr':'.jpg,.jpeg,.png,.webp,.hdr';input.onchange=async()=>{const file=input.files[0];if(!file)return;try{if(file.size>50*1024*1024)throw Error('环境资源不能超过50MB');const format=/\.hdr$/i.test(file.name)?'hdr':'image';if(kind==='lighting'&&format!=='hdr')throw Error('请选择HDRI文件');const header=new TextDecoder().decode(await file.slice(0,16).arrayBuffer());if(format==='hdr'&&!/^#\?(RADIANCE|RGBE)/.test(header))throw Error('无效的HDRI文件');const url=await window.LocalAssets.put(file),resource={url,format,name:file.name};await this.textureStore().get(resource);await this.setEnvironment(()=>{const e=this.data.environment;if(kind==='lighting'){e.hdri=resource;e.preset=null;(e.hdriResources??=[]).push(resource);}else{e.panorama=resource;e.background='panorama';(e.panoramaResources??=[]).push(resource);}});}catch(error){this.notify(error.message);}};input.click();},
  async close(){await closeBase.call(this);this.worldSceneSequence=(this.worldSceneSequence||0)+1;if(this.worldScene){this.scene.remove(this.worldScene);this.disposeObject({root:this.worldScene});this.worldScene=null;}this.environmentSequence=(this.environmentSequence||0)+1;this.closeEnvironmentPanel?.();this.environmentTextures?.dispose();}
 });
}
