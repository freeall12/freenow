(() => {
 const storage=window.localStorage,session=new URLSearchParams(location.search).get('session'),prefix='qa-canvas-groups:'+(session?encodeURIComponent(session)+':':'');Object.defineProperty(window,'localStorage',{value:{getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,String(value)),removeItem:key=>storage.removeItem(prefix+key)}});
 if(new URLSearchParams(location.search).has('studioCapture'))window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 const referenceGraph=window.CANVAS_DATA;
 window.CANVAS_DATA={referenceWidth:889,referenceHeight:1011,edges:[{id:'ab',source:'a',target:'b'},{id:'ac',source:'a',target:'c'}],nodes:[{id:'a',type:'image',title:'第一镜',image:'/assets/tap-logo.webp',x:53284.3,y:-2180.48,width:435,height:250},{id:'b',type:'image',title:'第二镜',image:'/assets/tap-logo.webp',x:53800.25,y:-1800.8,width:435,height:250},{id:'c',type:'text',title:'摄影脚本',content:'摄影机沿河移动',x:54300,y:-2000,width:435,height:250},{id:'studio',type:'studio',title:'片场',x:55400,y:-2000,width:375,height:250}]};
 if(new URLSearchParams(location.search).has('panoramaPreview'))window.CANVAS_DATA.nodes.push({id:'panorama-preview',type:'image',title:'全景投影验收',image:'/qa/panorama-upload-fixture.png',x:53702.632425281205,y:-2697.8231751937797,width:512,height:256});
 if(new URLSearchParams(location.search).has('composerVideoFixture'))window.CANVAS_DATA.nodes.push({id:'composer-video',type:'video',title:'视频参数验收',video:'/qa/video-cut-fixture.mp4',image:'/assets/tap-logo.webp',x:53500.125,y:-2800.375,width:435,height:250,generation:{prompt:'视频播放与参数编辑',refs:[],model:'Seedance 2.0',ratio:'16:9',quality:'1080p',duration:5,count:1}});
 if(new URLSearchParams(location.search).has('mixedReferences'))window.CANVAS_DATA.nodes.push(
  {id:'reference-video',type:'video',title:'参考动作视频',video:'/qa/video-cut-fixture.mp4',image:'/assets/studio/library/bicycle-city.webp',x:52900.125,y:-2800.375,width:435,height:250},
  {id:'reference-audio',type:'audio',audioMode:'upload',title:'参考声音',audio:'/qa/audio-upload-fixture.wav',x:52900.125,y:-3200.375,width:300,height:300}
 );
 if(new URLSearchParams(location.search).has('fullCanvasFixture'))window.CANVAS_DATA=structuredClone(referenceGraph);
 // Explicit performance load only; small shared assets isolate graph/DOM CPU cost.
 if(new URLSearchParams(location.search).has('performanceLarge')){
  const nodes=[],edges=[];
  for(let i=0;i<400;i++)nodes.push({id:'perf-image-'+i,type:'image',title:'性能图片 '+i,image:'/assets/tap-logo.webp',x:52000+(i%20)*480,y:-3500+Math.floor(i/20)*320,width:435,height:250});
  for(let i=0;i<100;i++)nodes.push({id:'perf-pile-'+i,type:'pile',title:'性能堆叠 '+i,x:52000+(i%20)*480,y:3500+Math.floor(i/20)*320,width:435,height:250,memberIds:[0,1,2].map(j=>'perf-image-'+(i*3+j))});
  for(let i=0;i<200;i++)edges.push({id:'perf-edge-'+i,source:'perf-image-'+(300+i%100),target:'perf-image-'+(300+(i+1+i%7)%100)});
  window.CANVAS_DATA={...referenceGraph,nodes,edges};
  // Distinct local URLs exercise multi-asset selection rather than URL dedup.
  if(new URLSearchParams(location.search).has('subjectPerformance'))for(const node of nodes)if(node.image)node.image+='#'+node.id;
 }
 // Isolated manual scene-navigation fixture; never a generated result or design reference.
 if(new URLSearchParams(location.search).has('scenePreview'))window.CANVAS_DATA.nodes.push({id:'scene-preview',type:'world',title:'场景导航验收',outputType:'world',image:'/assets/studio/library/bicycle-city.webp',x:53702.632425281205,y:-2697.8231751937797,width:375,height:250,worldResource:{format:'glb',url:'/assets/studio/library/bicycle-city.glb',name:'bicycle-city.glb'}});
 document.addEventListener('canvas:render',()=>{const state=window.CanvasApp.getState();parent.postMessage({type:'group-qa-state',state:{view:state.view,selected:state.selected,nodes:state.nodes.map(({id,type,x,y,width,height,parentId})=>({id,type,x,y,width,height,parentId}))}},location.origin);});
 if(new URLSearchParams(location.search).has('inspectConnections'))window.addEventListener('DOMContentLoaded',()=>{
  const stats={added:0,removed:0,nodeAttributes:0,edgeAttributes:0,renders:0},panel=document.createElement('aside'),output=document.createElement('output'),reset=document.createElement('button');
  panel.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2000;background:#222;padding:8px;font:12px monospace';output.setAttribute('aria-label','连线验收统计');reset.textContent='重置节点重建计数';
  const draw=()=>{output.textContent=JSON.stringify(stats);};reset.onclick=()=>{for(const key of Object.keys(stats))stats[key]=0;draw();};panel.append(output,reset);document.body.append(panel);draw();
  for(const [label,ids] of [['选择两张图片',['a','b']],['选择图片和文本',['a','c']],['选择不兼容节点',['a','studio']]]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>window.CanvasApp.selectMany(ids);panel.append(button);}
  if(new URLSearchParams(location.search).has('fullCanvasFixture')){
   const busy=document.createElement('button');busy.textContent='切换版本忙碌验收（不调用生成）';let previous;
   busy.onclick=()=>{const id=document.querySelector('.version-count')?.closest('.node')?.dataset.id,n=window.CanvasApp.getState().nodes.find(n=>n.id===id);if(!n)return;if(previous){if(previous.had)n.pendingOperation=previous.value;else delete n.pendingOperation;previous=null;}else{previous={had:Object.hasOwn(n,'pendingOperation'),value:n.pendingOperation};n.pendingOperation='qa-inspect-busy';}busy.setAttribute('aria-pressed',String(!!previous));window.CanvasApp.render();};panel.append(busy);
  }
  const pointer=document.createElement('output');pointer.setAttribute('aria-label','连线指针事件');panel.append(pointer);for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,event=>{pointer.textContent=JSON.stringify({type,target:event.target.closest?.('[aria-label]')?.getAttribute('aria-label')||event.target.className,x:event.clientX,y:event.clientY});},true);
  const details=document.createElement('details'),summary=document.createElement('summary'),graph=document.createElement('pre');summary.textContent='查看连线图数据';graph.setAttribute('aria-label','连线图数据');graph.style.cssText='max-width:380px;max-height:180px;overflow:auto';details.append(summary,graph);panel.append(details);
  const inspect=()=>{const state=window.CanvasApp.getState();graph.textContent=JSON.stringify({nodes:state.nodes,edges:state.edges,selected:state.selected,view:state.view},null,2);};document.addEventListener('canvas:render',inspect);inspect();
  document.addEventListener('canvas:render',()=>{stats.renders++;draw();});
  const attributes=(root,key)=>new MutationObserver(records=>{stats[key]+=records.length;output.dataset[key]=JSON.stringify(records.slice(-12).map(r=>({node:r.target.closest('.node')?.dataset.id,tag:r.target.tagName,class:r.target.className,attribute:r.attributeName,value:r.target.getAttribute(r.attributeName)})));draw();}).observe(root,{attributes:true,subtree:true});attributes(document.querySelector('#nodes'),'nodeAttributes');attributes(document.querySelector('#edges'),'edgeAttributes');
  new MutationObserver(records=>{for(const r of records){stats.added+=[...r.addedNodes].filter(n=>n.nodeType===1&&n.matches('.node')).length;stats.removed+=[...r.removedNodes].filter(n=>n.nodeType===1&&n.matches('.node')).length;}draw();}).observe(document.querySelector('#nodes'),{childList:true});
 });
 // Use the production store in every QA session. Retain the previous mediaStore
 // namespace and read legacy graph data only when IndexedDB has no document.
 // A failed read must reject rather than fall back to a seed graph and overwrite it.
 window.CANVAS_DB_NAME=prefix+'media';
 const ready=import('/canvas-store.js').then(()=>window.CanvasStore);
 window.CanvasStore={load:async()=>await (await ready).load()??JSON.parse(localStorage.getItem('graph')||'null'),save:graph=>{const snapshot=structuredClone(graph);return ready.then(store=>store.save(snapshot));},readRecord:key=>ready.then(store=>store.readRecord(key)),writeRecord:(key,value)=>{const snapshot=structuredClone(value);return ready.then(store=>store.writeRecord(key,snapshot));},flush:async()=>(await ready).flush()};
})();

// Explicit, isolated recognition protocol fixture. Never enabled on the product entrypoint.
if(new URLSearchParams(location.search).has('focusEditFixture'))window.addEventListener('DOMContentLoaded',()=>{
 const bar=document.createElement('aside');bar.style.cssText='position:fixed;left:12px;top:60px;z-index:2000;background:#222;padding:8px;color:white;font-size:12px';
 const note=document.createElement('span');note.textContent='识别接口验收：固定候选数据，不是AI输出';
 const prepare=document.createElement('button');prepare.textContent='选择焦点编辑源图';prepare.onclick=()=>{window.NodeEditor.setConfig('b',{prompt:'保留参考元素',refs:[]});window.CanvasApp.select('b');};
 const requestInfo=document.createElement('output');requestInfo.setAttribute('aria-label','焦点识别请求');
 const enable=document.createElement('button');enable.textContent='启用固定识别接口';enable.onclick=()=>{window.GenerationAPI.setProvider({async generate(request,{signal}){if(request.kind!=='image.recognize')throw Error('验收适配器仅支持识别');requestInfo.textContent=JSON.stringify(request.parameters);await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,900);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('已取消'));},{once:true});});return {outputs:[{type:'text',text:JSON.stringify({items:[{label_name:'测试标志',label_desc:'固定结果用于交互验收',box_2d:[.15,.2,.85,.8]},{label_name:'测试背景',box_2d:[.02,.02,.98,.98]}]})}]};}});enable.textContent='固定识别接口已启用';};
 bar.append(note,prepare,enable,requestInfo);document.body.append(bar);
});

if(new URLSearchParams(location.search).has('composerContentFixture'))window.addEventListener('DOMContentLoaded',()=>{
 const bar=document.createElement('aside');bar.style.cssText='position:fixed;left:12px;top:60px;z-index:2000;background:#222;padding:8px;color:white;font-size:12px';
 const button=document.createElement('button');button.textContent='加载长提示词与12张参考';button.onclick=()=>{window.NodeEditor.setConfig('b',{prompt:Array.from({length:18},(_,i)=>`第${i+1}行：保留构图、光照与镜头位置，检查长提示词展开与折叠。`).join('\n'),refs:Array.from({length:12},(_,i)=>['/assets/tap-logo.webp','/assets/studio/library/bicycle-city.webp','/qa/panorama-upload-fixture.png'][i%3]+(i?'?reference='+i:'')),referenceBindings:Array.from({length:12},(_,i)=>i===0?'a':null)});window.CanvasApp.select('b');};bar.append(button);document.body.append(bar);
});

// Requests are inspected through the real task service; no mock generation success.
if(new URLSearchParams(location.search).has('mixedReferences'))window.addEventListener('DOMContentLoaded',()=>{
 const bar=document.createElement('aside');bar.style.cssText='position:fixed;left:12px;top:100px;z-index:2000;background:#222;padding:8px;color:white;font-size:12px';
 const button=document.createElement('button');button.textContent='连接四类参考素材';button.onclick=()=>{for(const id of ['a','reference-video','reference-audio','c'])if(!window.CanvasApp.getState().edges.some(e=>e.source===id&&e.target==='composer-video'))window.CanvasApp.connect(id,'composer-video');window.CanvasApp.select('composer-video',true);};
 const request=document.createElement('output');request.ariaLabel='生成参考请求';request.style.cssText='display:block;max-width:280px;max-height:120px;overflow:auto;white-space:pre-wrap';
 window.GenerationAPI.subscribe(job=>{if(job.request.nodeId==='composer-video')request.textContent=JSON.stringify({status:job.status,prompt:job.request.prompt,inputs:job.request.inputs,parameters:job.request.parameters});});
 const legacy=document.createElement('button');legacy.textContent='加载旧版图片参考绑定';legacy.onclick=()=>window.NodeEditor.setConfig('composer-video',{refs:['/assets/tap-logo.webp'],referenceBindings:['a']});const seed=document.createElement('button');seed.textContent='载入素材库引用验收素材';seed.onclick=()=>{
  const fixtures=[{id:'mention-image',type:'image',name:'黄昏街景',image:'/assets/studio/library/bicycle-city.webp',folder:'场景',scope:'personal'},{id:'mention-text',type:'text',name:'摄影提示',content:'低机位跟拍，保留街道环境声。',folder:'场景/镜头',scope:'personal'},{id:'mention-video',type:'video',name:'运动参考',video:'/qa/video-cut-fixture.mp4',image:'/assets/tap-logo.webp',folder:'场景',scope:'team'},{id:'mention-audio',type:'audio',name:'街道环境声',audio:'/qa/audio-upload-fixture.wav',folder:'音效',scope:'team'}];
  for(const item of fixtures)if(!window.CanvasLibrary.items.some(old=>old.id===item.id))window.CanvasLibrary.items.push(item);
  localStorage.setItem('tapnow-library',JSON.stringify(window.CanvasLibrary.items));seed.textContent='素材库验收素材已载入';
 };bar.append(button,legacy,seed,request);document.body.append(bar);
});

// Manual first/last frame checks use distinct existing assets and fractional positions.
if(new URLSearchParams(location.search).has('frameReferences'))window.addEventListener('DOMContentLoaded',()=>{
 const bar=document.createElement('aside');bar.style.cssText='position:fixed;left:12px;top:60px;z-index:2000;background:#222;padding:8px;color:white;font-size:12px';
 const prepare=document.createElement('button');prepare.textContent='准备首尾帧验收';prepare.onclick=()=>{
  const app=window.CanvasApp;app.removeEdges(app.getState().edges.filter(e=>e.target==='composer-video').map(e=>e.id));
  app.updateNode('a',{x:53284.3,y:-3180.48});app.updateNode('b',{x:53800.25,y:-3180.8,image:'/assets/studio/library/bicycle-city.webp'});
  window.NodeEditor.setConfig('composer-video',{model:'Seedance 2.0',mode:'首尾帧',videoMode:undefined,refs:[],referenceBindings:[],referenceOrder:[],prompt:'首尾帧顺序验收'});
  app.select('composer-video');const rect=document.querySelector('#canvas').getBoundingClientRect();app.setView({scale:.35,x:rect.width/2-53717.625*.35,y:200+2800.375*.35});
 };bar.append(prepare);document.body.append(bar);
});
if(new URLSearchParams(location.search).has('subjectReferences'))window.addEventListener('DOMContentLoaded',()=>{
 const bar=document.createElement('aside');bar.style.cssText='position:fixed;right:12px;top:60px;z-index:2000;background:#222;padding:8px;color:white;font-size:12px';
 const prepare=document.createElement('button');prepare.textContent='准备主体验收';prepare.onclick=()=>{
  const app=window.CanvasApp;app.removeEdges(app.getState().edges.filter(e=>e.target==='composer-video').map(e=>e.id));
  app.updateNode('a',{x:53284.3,y:-3180.48});app.updateNode('b',{x:53800.25,y:-3180.8,image:'/assets/studio/library/bicycle-city.webp'});
  window.NodeEditor.setConfig('composer-video',{model:'Seedance 2.0',mode:'全能参考',videoMode:undefined,refs:[],referenceBindings:[],referenceOrder:[],prompt:'主体动作验收'});
  app.select('composer-video');const rect=document.querySelector('#canvas').getBoundingClientRect();app.setView({scale:.35,x:rect.width/2-53717.625*.35,y:200+2800.375*.35});
 };
 const inspect=document.createElement('button');inspect.textContent='查看主体请求';const output=document.createElement('pre');output.ariaLabel='主体请求记录';output.hidden=true;output.style.cssText='max-width:380px;max-height:160px;overflow:auto';inspect.onclick=()=>{output.hidden=false;output.textContent=JSON.stringify(window.GenerationAPI.getJobs().map(job=>({status:job.status,request:job.request})),null,2);};bar.append(prepare,inspect,output);document.body.append(bar);
});

// Manual reconciliation checks preserve real media elements; no generated data or API calls.
if(new URLSearchParams(location.search).has('reconcileFixture'))window.addEventListener('DOMContentLoaded',()=>{
 const bar=document.createElement('aside');bar.style.cssText='position:fixed;left:12px;top:60px;z-index:2000;background:#222;padding:8px;font:12px monospace;max-width:430px';
 const output=document.createElement('output');output.setAttribute('aria-label','节点复用验收');output.style.cssText='display:block;max-height:120px;overflow:auto;overflow-wrap:anywhere';let baseline;
 const capture=()=>{baseline={nodes:new Map([...document.querySelectorAll('#nodes>.node')].map(n=>[n.dataset.id,n])),media:document.querySelector('.node[data-id="composer-video"] video')};draw();};
 const draw=()=>{if(!baseline)return;const media=document.querySelector('.node[data-id="composer-video"] video');output.textContent=JSON.stringify({sameNodes:[...baseline.nodes].filter(([id,n])=>n===document.querySelector(`.node[data-id="${CSS.escape(id)}"]`)).map(([id])=>id),sameVideo:!!media&&media===baseline.media,videoConnected:!!baseline.media?.isConnected,previousVideoPaused:baseline.media?.paused,paused:media?.paused,time:media?.currentTime});};
 const action=(label,run)=>{const b=document.createElement('button');b.textContent=label;b.onclick=run;bar.append(b);};
 action('定位验收视频',()=>window.CanvasApp.select('composer-video',true));
 action('记录节点与媒体身份',capture);
 action('切换视频验收素材',()=>window.CanvasApp.updateNode('composer-video',{video:'/qa/playlist-red.mp4'}));
 action('重命名验收视频',()=>window.CanvasApp.updateNode('composer-video',{title:'视频参数验收·修改后'}));
 action('重命名第一镜',()=>window.CanvasApp.updateNode('a',{title:'第一镜·修改后'}));
 action('仅更新脚本底色',()=>window.CanvasApp.updateNode('c',{color:'#e8d5d2'}));
 action('更新脚本文本和底色',()=>window.CanvasApp.updateNode('c',{content:'## 修改后的镜头\n摄影机缓慢向前移动。',color:'#e8d5d2'}));
 action('切换第一镜为文本',()=>window.CanvasApp.updateNode('a',{type:'text',image:null,fullImage:null,content:'类型转换后的文本',textMode:'pure'}));
 action('删除第二镜',()=>window.CanvasApp.remove(['b']));
 action('新增图片节点',()=>window.CanvasApp.addNode('image',undefined,'/assets/tap-logo.webp','新增验收图片'));
 bar.append(output);document.body.append(bar);document.addEventListener('canvas:render',()=>queueMicrotask(draw));
});

// Explicit UI actions for dynamic minimap checks; graph writes stay in the QA session.
if(new URLSearchParams(location.search).has('minimapFixture'))window.addEventListener('DOMContentLoaded',()=>{
 const bar=document.createElement('aside');bar.style.cssText='position:fixed;left:245px;top:12px;right:180px;z-index:2000;background:#222;padding:8px;font:12px monospace';
 const output=document.createElement('output');output.ariaLabel='动态小地图验收';output.style.cssText='display:block;max-height:100px;overflow:auto;overflow-wrap:anywhere';
 const action=(label,run)=>{const b=document.createElement('button');b.textContent=label;b.onclick=run;bar.append(b);};
 action('准备负坐标小地图',()=>{const app=window.CanvasApp;for(const [id,x,y] of [['a',-100123.456,-80000.125],['b',-99323.125,-80000.875],['c',-100123.75,-79000.625],['studio',-99323.375,-79000.25]])app.updateNode(id,{x,y});app.selectMany([]);app.setView({x:450+100123.456*.4,y:220+80000.125*.4,scale:.4});});
 action('新增远处负坐标',()=>{const n=window.CanvasApp.addNode('image',undefined,'/assets/tap-logo.webp','远处负坐标');window.CanvasApp.updateNode(n.id,{x:-260123.456,y:-180987.654});});
 action('删除远处节点',()=>{const ids=window.CanvasApp.getState().nodes.filter(n=>n.title==='远处负坐标').map(n=>n.id);if(ids.length)window.CanvasApp.remove(ids);});
 action('两图打组并设色',()=>{const app=window.CanvasApp,state=app.getState(),a=state.nodes.find(n=>n.id==='a'),b=state.nodes.find(n=>n.id==='b'),existing=a?.parentId&&a.parentId===b?.parentId?state.nodes.find(n=>n.id===a.parentId):null,node=existing||app.group(['a','b']);if(node){app.updateNode(node.id,{groupColor:'#e7b870cc'});app.select(node.id);}});
 action('显示全图',()=>document.querySelector('#reset').click());
 action('启动定位和后台重绘',()=>{const app=window.CanvasApp,view=app.getState().view;app.transitionView({...view,x:view.x+1200,y:view.y+700},3000);const timer=setInterval(()=>app.render(),20);setTimeout(()=>clearInterval(timer),5000);});
 document.querySelector('#minimap').addEventListener('pointerdown',event=>{output.dataset.pointerStart=JSON.stringify({view:window.CanvasApp.getState().view,moving:document.querySelector('#canvas').dataset.viewportMotion,clientX:event.clientX,clientY:event.clientY,marks:[...document.querySelectorAll('.minimap-nodes rect')].map(n=>({id:n.dataset.nodeId,x:Number(n.getAttribute('x')),y:Number(n.getAttribute('y')),width:Number(n.getAttribute('width'))})),rect:document.querySelector('#minimap').getBoundingClientRect().toJSON()});},{capture:true});
 const draw=()=>{const state=window.CanvasApp.getState();output.textContent=JSON.stringify({nodes:state.nodes.map(({id,x,y,type,parentId,groupColor})=>({id,x,y,type,parentId,groupColor})),view:state.view,selected:state.selected});};bar.append(output);document.body.append(bar);document.addEventListener('canvas:render',()=>queueMicrotask(draw));draw();
});

if(new URLSearchParams(location.search).has('studioCapture'))window.addEventListener('load',()=>import('./studio-capture-controls.mjs'));
