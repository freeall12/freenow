const app=window.CanvasApp,fixture=window.AgentVideoMaskFixture;
if(!fixture?.state||fixture.state.bootstrapError)throw Error('隔离Agent视频蒙层验收未启动：'+(fixture?.state?.bootstrapError||'fixture missing'));
const panel=document.createElement('aside');panel.setAttribute('aria-label','隔离Agent视频蒙层验收');panel.style.cssText='position:fixed;left:12px;top:70px;z-index:2100;display:flex;flex-direction:column;gap:6px;box-sizing:border-box;width:min(210px,calc(100vw - 24px));max-height:calc(100dvh - 84px);overflow:hidden;background:#171717;border:1px solid #555;color:#eee;padding:10px;font:12px sans-serif';
panel.addEventListener('pointerdown',event=>event.stopPropagation());
const label=document.createElement('strong');label.textContent='隔离协议验收 · 合成完整蒙层/固定MP4/真实生产审批';label.style.cssText='flex-shrink:0;overflow-wrap:anywhere';panel.append(label);
const output=document.createElement('pre');output.ariaLabel='视频蒙层验收计数';output.style.cssText='flex:1 1 auto;min-height:0;max-height:40vh;overflow:auto;margin:0';panel.append(output);
const fold=document.createElement('button');fold.textContent='收起验收数据';fold.setAttribute('aria-expanded','true');fold.onclick=()=>{output.hidden=!output.hidden;fold.textContent=output.hidden?'展开验收数据':'收起验收数据';fold.setAttribute('aria-expanded',String(!output.hidden));};panel.append(fold);
const toggle=document.createElement('button');toggle.textContent='切换服务配置';toggle.onclick=()=>{fixture.setConfigured(!fixture.state.configured);window.GenerationAPI.configure();};panel.append(toggle);
const alter=document.createElement('button');alter.textContent='改变来源选段';alter.onclick=()=>{app.updateNode('video-mask-source',{clip:{start:2,end:6}});write();};panel.append(alter);
const remove=document.createElement('button');remove.textContent='清除夹具蒙层';remove.onclick=()=>{app.updateNode('video-mask-source',{videoMask:null});fixture.state.maskReady=false;fixture.change();};panel.append(remove);document.body.append(panel);
for(const button of panel.querySelectorAll('button'))button.style.cssText='flex-shrink:0;min-height:24px;white-space:normal;overflow-wrap:anywhere';
function requestPath(path){
 if(typeof path!=='string')return {path};
 const data=path.match(/^(?:data:)?([a-z][a-z0-9.+-]*\/[a-z0-9.+-]+)(?:;[^,]*)?,/i);
 if(data)return {scheme:'data',mimeType:data[1],characters:path.length};
 if(/^(?:blob:|https?:\/\/)/i.test(path))return {scheme:'blob',characters:path.length};
 return {path};
}
function write(){const state=app.getState(),source=state.nodes.find(node=>node.id==='video-mask-source'),mask=source?.videoMask;output.textContent=JSON.stringify({kind:fixture.state.kind,configured:fixture.state.configured,maskReady:fixture.state.maskReady,sourceClip:source?.clip??null,sourceMask:mask?{asset:mask.asset,source:mask.source,clip:mask.clip,time:mask.time,width:mask.width,height:mask.height,duration:mask.duration}:null,taskRecords:fixture.state.taskRecords,posts:fixture.state.taskRecords==='ready'?fixture.state.posts.length:null,postsDetail:fixture.state.taskRecords==='ready'?fixture.state.posts:null,sourceReads:fixture.state.sourceReads,replacementReads:fixture.state.replacementReads,thumbnailReads:fixture.state.thumbnailReads,maskReads:fixture.state.maskReads,requests:fixture.state.requests.map(({path,...record})=>({...record,...requestPath(path)})),errors:fixture.state.errors.map(({path,...record})=>({...record,...(path!==undefined?requestPath(path):{})})),nodes:state.nodes.length,edges:state.edges.length,jobs:window.GenerationAPI.getJobs().map(job=>({id:job.id,status:job.status,applied:job.applied,applicationError:job.applicationError,resultIds:job.resultIds}))},null,2);}
window.addEventListener('qa-agent-video-mask:change',write);window.GenerationAPI.subscribe(write);window.addEventListener('canvas:nodes-changed',write);write();
const ready=(async()=>{
 // Hydration may outlive module execution, especially on reload. Wait for the
 // actual app save boundary so seeding cannot race a saved project load.
 for(let attempt=0;;attempt++){try{await app.saveProject();break;}catch(error){if(attempt>=99||!String(error?.message).includes('尚未成功读取'))throw error;await new Promise(resolve=>setTimeout(resolve,20));}}
 const source=app.getState().nodes.find(node=>node.id==='video-mask-source');if(!source)throw Error('夹具来源缺失');
 if(fixture.state.missingMask){if(source.videoMask)app.updateNode(source.id,{videoMask:null});}
 else if(!source.videoMask){
  const mask={encoding:'rle-zero-based-row-major',width:320,height:180,fps:30,frames:Array.from({length:240},(_,i)=>`${(20+Math.floor(i/10))*320+40} 20`)};
  const {validateMask}=await import('../src/features/video-mask/core.mjs');validateMask(mask,{width:320,height:180,duration:8});
  const asset=await window.LocalAssets.put(new Blob([JSON.stringify(mask)],{type:'application/json'}));
  app.updateNode(source.id,{videoMask:{source:source.video,clip:JSON.stringify(source.clip||null),asset,time:2,width:320,height:180,duration:8}});await app.saveProject();
 }
 fixture.state.maskReady=!!source.videoMask;fixture.change();
})();ready.catch(error=>{fixture.state.errors.push({seed:String(error?.message||error)});fixture.change();});
const open=async()=>{await ready;if(!localStorage.getItem('qa-video-mask-view')){document.querySelector('#reset').click();localStorage.setItem('qa-video-mask-view','set');}window.AgentUI.open();};
if(document.readyState==='complete')void open();else window.addEventListener('load',()=>void open(),{once:true});
