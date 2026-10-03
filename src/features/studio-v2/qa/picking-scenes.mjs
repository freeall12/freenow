import * as THREE from 'three';

export const pickingCases=[
  ['alpha-hole','01 · 贴图透明孔'],['opacity','02 · opacity 0.049 / 0.05 / 0.051'],
  ['alpha-green','03 · alphaMap 绿色通道'],['mask','04 · MASK / alphaTest'],
  ['lines-points','05 · Line / 虚线 / Points'],['deformation','06 · morph / skin 及透明孔'],
  ['camera-helper','07 · 相机辅助体'],['camera-occluded','08 · 相机辅助体遮挡'],
  ['animated','09 · 播放中点选并停止'],
];

function identify(object,id,name=id){object.userData.studioId=id;object.name=name;return object;}
function texture(pixel,size=32){
  const bytes=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)bytes.set(pixel((x+.5)/size,(y+.5)/size),4*(y*size+x));
  const map=new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat);map.magFilter=map.minFilter=THREE.NearestFilter;map.generateMipmaps=false;map.needsUpdate=true;return map;
}
const hole=()=>texture((u,v)=>[255,255,255,Math.hypot(u-.5,v-.5)<.2?0:255]);
function material(options={}){return new THREE.MeshStandardMaterial({color:0xe77632,roughness:.9,metalness:0,side:THREE.DoubleSide,...options});}
function plane(root,id,x,y,z,width=1.8,height=2,options={}){
  const mesh=identify(new THREE.Mesh(new THREE.PlaneGeometry(width,height),material(options)),id);mesh.position.set(x,y,z);root.add(mesh);return mesh;
}

// These are synthetic GPU probes. Pixel expectations describe the original
// material contract, not a CPU raycast or an automatically selected object.
export function buildPickingCase(key){
  if(!pickingCases.some(([id])=>id===key))throw Error('未知 picking QA 分组');
  const root=new THREE.Scene();root.name='Synthetic GPU picking '+key;
  const samples=[],clips=[];
  const probe=(name,point,expectedId,pixelOffset)=>samples.push({name,point,expectedId,...pixelOffset?{pixelOffset}:{}});
  const back=(id,x=0,width=7,height=4)=>plane(root,id,x,0,-1,width,height,{color:0x238aa0});
  if(key==='alpha-hole'){
    back('qa-hole-back',0,4,3);plane(root,'qa-hole-front',0,0,0,4,3,{map:hole(),transparent:true});
    probe('实心 → 前景',[-1.25,0,0],'qa-hole-front');probe('孔 → 后景',[0,0,-1],'qa-hole-back');
  }else if(key==='opacity'){
    [.049,.05,.051].forEach((opacity,index)=>{const x=(index-1)*2.1,id='qa-opacity-'+String(opacity).replace('.','_');back(id+'-back',x,1.7,2);plane(root,id+'-front',x,0,0,1.7,2,{opacity,transparent:true});probe(String(opacity),[x,0,opacity<.05?-1:0],id+(opacity<.05?'-back':'-front'));});
  }else if(key==='alpha-green'){
    for(const [index,green,alpha]of [[0,0,255],[1,255,0]]){const x=index?1.4:-1.4,id='qa-green-'+green;back(id+'-back',x,2,2);plane(root,id+'-front',x,0,0,2,2,{alphaMap:texture(()=>[255,green,255,alpha]),transparent:true});probe('G='+green+' A='+alpha,[x,0,green?0:-1],id+(green?'-front':'-back'));}
  }else if(key==='mask'){
    [.25,.75].forEach((opacity,index)=>{const x=index?1.4:-1.4,id='qa-mask-'+index;back(id+'-back',x,2,2);plane(root,id+'-front',x,0,0,2,2,{opacity,alphaTest:.5});probe('alpha='+opacity+' / test=.5',[x,0,index?0:-1],id+(index?'-front':'-back'));});
  }else if(key==='lines-points'){
    back('qa-primitives-back');
    const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.5,.6,0),new THREE.Vector3(-.7,.6,0)]);
    root.add(identify(new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xffde52})),'qa-line'));
    const dashed=identify(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.5,-.65,0),new THREE.Vector3(-.7,-.65,0)]),new THREE.LineDashedMaterial({color:0xffde52,dashSize:.35,gapSize:.35})),'qa-dashed');dashed.computeLineDistances();root.add(dashed);
    const sprite=texture((u,v)=>[255,255,255,Math.hypot(u-.5,v-.5)<.43?255:0]);
    const points=identify(new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(1.5,0,0)]),new THREE.PointsMaterial({color:0xf06c37,size:48,sizeAttenuation:false,map:sprite,transparent:true})),'qa-points');root.add(points);
    probe('Line（细线需精确点击）',[-1.6,.6,0],'qa-line');probe('虚线实线',[-2.325,-.65,0],'qa-dashed');probe('虚线空档',[-1.975,-.65,-1],'qa-primitives-back');
    probe('点精灵中心',[1.5,0,0],'qa-points');probe('点精灵透明角',[1.5,0,0],'qa-primitives-back',[20,20]);
  }else if(key==='deformation'){
    back('qa-deform-back');
    const morph=plane(root,'qa-morph',-2.1,0,0,1,1.5,{map:hole(),transparent:true});
    // Parametric PlaneGeometry JSON rebuilds only its constructor parameters;
    // generic BufferGeometry retains the added morph/skin vertex attributes.
    const originalMorph=morph.geometry;morph.geometry=new THREE.BufferGeometry().copy(originalMorph);originalMorph.dispose();
    const attribute=morph.geometry.attributes.position,positions=new Float32Array(attribute.array);
    for(let i=0;i<positions.length;i+=3)positions[i]+=1.15;
    morph.geometry.morphAttributes.position=[new THREE.Float32BufferAttribute(positions,3)];morph.updateMorphTargets();morph.morphTargetInfluences[0]=1;
    const originalSkin=new THREE.PlaneGeometry(1,1.5),skinGeometry=new THREE.BufferGeometry().copy(originalSkin),vertices=skinGeometry.attributes.position.count;originalSkin.dispose();
    skinGeometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(vertices*4),4));
    const weights=new Float32Array(vertices*4);for(let i=0;i<vertices;i++)weights[4*i]=1;skinGeometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const skin=identify(new THREE.SkinnedMesh(skinGeometry,material({map:hole(),transparent:true})),'qa-skinned');skin.position.x=1;
    const bone=identify(new THREE.Bone(),'qa-bone');skin.add(bone);root.add(skin);skin.bind(new THREE.Skeleton([bone]));bone.position.x=1.3;skin.updateMatrixWorld(true);skin.skeleton.update();
    probe('morph 变形实心',[-.65,0,0],'qa-morph');probe('morph 孔',[-.95,0,0],'qa-deform-back');probe('morph 旧位置',[-2.1,0,0],'qa-deform-back');
    probe('skin 变形实心',[2.6,0,0],'qa-skinned');probe('skin 孔',[2.3,0,0],'qa-deform-back');probe('skin 旧位置',[1,0,0],'qa-deform-back');
  }else if(key==='animated'){
    back('qa-animation-back');const moving=plane(root,'qa-animated',-1.4,0,0,1.5,1.5,{map:hole(),transparent:true});
    clips.push(new THREE.AnimationClip('QA 移动对象',12,[new THREE.VectorKeyframeTrack(moving.uuid+'.position',[0,6,12],[-1.4,0,0,1.4,0,0,-1.4,0,0])]));
    probe('运动中实心',[-.9,0,0],'qa-animated');samples.at(-1).follow={id:'qa-animated',point:[.5,0,0]};
    probe('运动中孔',[-1.4,0,0],'qa-animation-back');samples.at(-1).follow={id:'qa-animated',point:[0,0,0]};
  }else{
    // Large background gives the production helper a visible model-derived
    // scale. Its geometry and camera mapping are the real CameraPresentations.
    back('qa-camera-back');const bounds=plane(root,'qa-helper-bounds',0,0,-3,30,10);bounds.visible=false;
    const camera=identify(new THREE.PerspectiveCamera(50,1,.1,30),'qa-camera');root.add(camera);
    clips.push(new THREE.AnimationClip('QA helper motion',2,[new THREE.VectorKeyframeTrack(camera.uuid+'.position',[0,2],[0,0,0,0,0,0])]));
    if(key==='camera-occluded'){plane(root,'qa-camera-occluder',0,0,2,1.2,1.2,{color:0xaf443c});probe('遮挡体',[0,0,2],'qa-camera-occluder');}
    else {probe('相机机身',[0,0,.42],'qa-camera');probe('相机轮廓（实际辅助线）',[0,-.3,-.86],'qa-camera');}
  }
  probe('空白 → 清除选择',[0,-2.35,0],null);
  root.updateMatrixWorld(true);
  return {root,clips,samples,key};
}
