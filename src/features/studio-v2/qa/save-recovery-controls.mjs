import {exportGlb,disposeModel,primitive} from '/src/features/studio-v2/model-io.mjs';
import * as THREE from 'three';

// Dedicated local QA. The model is generated geometry, never an AI response.
const panel=document.createElement('aside');panel.ariaLabel='片场保存恢复 QA';
panel.style.cssText='position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:480;width:310px;padding:8px;color:#eee;background:#202020;border:1px solid #777;font:12px sans-serif';
const heading=document.createElement('strong');heading.textContent='片场保存恢复 · 隔离 QA';const buttons=document.createElement('div'),out=document.createElement('output');out.style.cssText='display:block;white-space:pre-wrap;margin-top:6px';panel.append(heading,buttons,out);document.body.append(panel);
let nodeId,error='',armed=false,restorePut=null;const observations=[];
const active=()=>window.StudioAPI?.active?.runtime;
function refresh(){const rt=active();out.textContent=JSON.stringify({namespace:window.StudioSaveRecoveryFixture.namespace,externalAttempts:window.StudioSaveRecoveryFixture.externalAttempts,blockedAPIs:window.StudioSaveRecoveryFixture.blockedAPIs,armed,error,nodeId,saveError:rt?.saveError?.message,revision:rt?.revision,savedRevision:rt?.savedRevision,reloading:rt?.reloading,cubeX:rt?.find('qa-cube')?.position.x,camera:rt?.shotId,motion:rt?.motionIndex,observations},null,2);}
function button(label,run){const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='margin:4px 3px;padding:5px;background:#333;color:white;border:1px solid #777';b.onclick=async()=>{b.disabled=true;error='';try{await run();}catch(cause){error=cause.message;}finally{b.disabled=false;refresh();}};buttons.append(b);return b;}
button('准备并打开已保存片场',async()=>{
  if(armed)throw Error('请先执行已注入失败的修改');
  const app=window.CanvasApp;await app.saveProject();
  let node=app.getState().nodes.find(value=>value.id===nodeId)||app.getState().nodes.find(value=>value.title==='QA · 保存恢复片场');
  if(!node){
    const scene=new THREE.Scene(),cube=primitive('cube','QA 红色立方体'),camera=new THREE.PerspectiveCamera(50,16/9,.01,1000);cube.material.color.set('#ef3024');cube.userData.studioId='qa-cube';camera.name='QA 镜头';camera.userData.studioId='qa-camera';camera.position.set(0,1,3);scene.add(cube,camera);
    const clip=new THREE.AnimationClip('QA 运镜',2,[new THREE.VectorKeyframeTrack(camera.uuid+'.position',[0,1,2],[0,1,3,1,1,3,0,1,3])]);let blob;try{blob=await exportGlb(scene,[clip]);}finally{disposeModel(scene);}const asset=await window.LocalAssets.put(blob);
    node=app.addNode('studio',{x:480,y:200},null,'QA · 保存恢复片场',{studioV2:{version:2,asset,grid:true,shotId:'qa-camera',motionIndex:0,lighting:{azimuth:34,elevation:48},shotRatios:{'qa-camera':{width:16,height:9}}}});await app.saveProject();
  }
  nodeId=node.id;await window.StudioAPI.open(node.id);observations.push('打开真实已保存GLB');
});
button('注入下一次保存失败',()=>{
  const rt=active();if(!rt||rt.saving||rt.reloading)throw Error('请先打开片场并等待保存完成');if(armed)throw Error('保存失败已注入');armed=true;
  const put=window.LocalAssets.put;restorePut=()=>{if(window.LocalAssets.put===once)window.LocalAssets.put=put;restorePut=null;};
  async function once(...args){restorePut();armed=false;observations.push('LocalAssets.put一次拒绝');queueMicrotask(refresh);throw Error('QA 一次本地保存失败');}
  window.LocalAssets.put=once;
});
button('修改立方体 X=2 并保存',async()=>{
  const rt=active();if(!rt)throw Error('请先打开片场');rt.update('qa-cube',{position:[2,.5,0]});clearTimeout(rt.saveTimer);try{await rt.flush();observations.push('修改保存成功');}catch(cause){observations.push('修改保留，等待真实放弃按钮');throw cause;}
});
button('刷新检查器',refresh);
button('收起 QA',()=>{for(const element of [heading,buttons,out])element.hidden=true;show.hidden=false;panel.style.width='auto';});
const show=document.createElement('button');show.textContent='展开保存恢复 QA';show.hidden=true;show.onclick=()=>{for(const element of [heading,buttons,out])element.hidden=false;show.hidden=true;panel.style.width='310px';refresh();};panel.append(show);
window.addEventListener('pagehide',()=>restorePut?.(),{once:true});
window.StudioSaveRecoveryQA={refresh,read:()=>({armed,error,observations:[...observations]})};refresh();
