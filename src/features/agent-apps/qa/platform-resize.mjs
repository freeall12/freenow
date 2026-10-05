import {createAppController,prepareApp} from '../integration.mjs';
import {platformResizeUri} from '../platform-resize.mjs';
import {createPlatformResizeRuntime} from '../platform-resize-runtime.mjs';
const $=id=>document.getElementById(id),projectId='platform-resize-qa',urls=new Map();
let database,chat={id:'platform-resize-qa-chat',messages:[]},graph={nodes:[],edges:[]},undo=[];
const specs=[{platform:'portrait',label_zh:'竖屏 9:16',label_en:'Portrait 9:16',ratio_id:'r_9_16'},{platform:'square',label_zh:'方图 1:1',label_en:'Square 1:1',ratio_id:'r_1_1'},{platform:'landscape',label_zh:'横屏 16:9',label_en:'Landscape 16:9',ratio_id:'r_16_9'},{platform:'wide',label_zh:'宽屏 2:1',label_en:'Wide 2:1',ratio_id:'r_2_1',selected:false}];
function transaction(mode,action) {return new Promise((resolve,reject)=>{const tx=database.transaction(['sessions','assets'],mode),result=action(tx);tx.oncomplete=()=>resolve(result?.result);tx.onerror=tx.onabort=()=>reject(tx.error||Error('隔离存储事务失败'));});}
const save=()=>transaction('readwrite',tx=>tx.objectStore('sessions').put(structuredClone({chat,graph,undo}),'current'));
async function openDatabase() {database=await new Promise((resolve,reject)=>{const request=indexedDB.open('tapnow-qa-platform-resize-v1',1);request.onupgradeneeded=()=>{request.result.createObjectStore('sessions');request.result.createObjectStore('assets');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('独立存储被旧页面阻塞'));});}
const localAssets={
  put:async blob=>{const ref='asset:'+crypto.randomUUID();await transaction('readwrite',tx=>tx.objectStore('assets').put(blob,ref));return ref;},
  url:async ref=>{if(urls.has(ref))return urls.get(ref);const blob=await transaction('readonly',tx=>tx.objectStore('assets').get(ref));if(!(blob instanceof Blob))throw Error('实际本地图片不存在');const url=URL.createObjectURL(blob);urls.set(ref,url);return url;}
};
const app={getState:()=>graph,createConnected:(sourceId,patches)=>{const previous=structuredClone(graph),nodes=patches.map((patch,index)=>({...structuredClone(patch),id:crypto.randomUUID(),x:480+index*360,y:0}));graph={nodes:[...graph.nodes,...nodes],edges:[...graph.edges,...nodes.map(node=>({id:crypto.randomUUID(),source:sourceId,target:node.id}))]};undo.push(previous);return nodes;}};
const runtime=createPlatformResizeRuntime({app,localAssets,getProjectId:()=>projectId,store:{save:async()=>{if($('failGraph').checked)return false;await save();return true;}},persistConversation:async()=>{if($('failChat').checked)return false;await save();await renderMedia();return true;}});
const controller=createAppController({
  getContext:()=>({chat,panelActive:true,pageLeaving:false,streaming:$('busy').checked,locale:$('locale').value}),
  getPlatformResizeSourceContext:(response,trace,currentChat)=>runtime.capture(response,{trace,chat:currentChat,isCurrent:()=>chat===currentChat&&chat.messages.includes(trace)}),
  onPlatformResizeApply:(args,trace,currentChat,options)=>options.sourceContext.apply(args,{...options,userAction:true}),
  onQueuePrompt:async()=>{throw Error('官方裁切不发送对话交接');},onSaveState:async()=>{throw Error('官方裁切没有可保存widget state');},
  onError:message=>{$('status').textContent=message;}
});
function render() {controller.prune(chat.messages);for(const trace of chat.messages){const card=controller.render(trace);if(card&&card.parentElement!==$('cards'))$('cards').append(card);}}
async function renderMedia() {
  $('source').replaceChildren();$('results').replaceChildren();
  for(const node of graph.nodes){const figure=document.createElement('figure'),image=document.createElement('img');image.src=await localAssets.url(node.fullImage);image.alt=node.title;const caption=document.createElement('figcaption');caption.textContent=node.title+(node.provenance?'\n'+node.pixelWidth+' × '+node.pixelHeight+'\n'+JSON.stringify(node.provenance.crop):'');figure.append(image,caption);(node.id==='source'?$('source'):$('results')).append(figure);}
  $('receipts').value=JSON.stringify(chat.messages.map(t=>({traceId:t.id,placements:t.platformResizePlacements||[]})),null,2);
  $('status').textContent=`真实图片 ${graph.nodes.length} 张；同批undo ${undo.length} 次；保存回执 ${chat.messages.reduce((n,t)=>n+(t.platformResizePlacements?.length||0),0)} 份。未调用生成服务。`;
}
async function source(blob,title) {if(!(blob instanceof Blob)||!['image/png','image/jpeg','image/webp'].includes(blob.type))throw Error('请选择PNG/JPEG/WebP真实图片');const asset=await localAssets.put(blob);controller.reset();chat={id:'platform-resize-qa-chat',messages:[]};graph={nodes:[{id:'source',type:'image',title,image:asset,fullImage:asset,x:0,y:0,width:320,height:213}],edges:[]};undo=[];await save();await renderMedia();}
async function sample() {const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='#f0eadb';ctx.fillRect(0,0,1200,800);const colors=['#ae403e','#1e765c','#236e9e','#d89937'];colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect((i%2)*600,Math.floor(i/2)*400,600,400);});ctx.lineWidth=12;ctx.strokeStyle='#f0eadb';for(let x=0;x<=1200;x+=100){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,800);ctx.stroke();}for(let y=0;y<=800;y+=100){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1200,y);ctx.stroke();}ctx.fillStyle='#f7f0df';ctx.font='bold 80px sans-serif';ctx.fillText('LEFT',45,210);ctx.fillText('RIGHT',700,610);ctx.fillStyle='#161616';ctx.beginPath();ctx.arc(600,400,120,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f7f0df';ctx.font='bold 44px sans-serif';ctx.fillText('CENTER',508,415);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));await source(blob,'1200×800 实际像素网格图');}
$('sample').onclick=()=>sample().catch(e=>$('status').textContent=e.message);
$('file').onchange=()=>source($('file').files[0],$('file').files[0]?.name).catch(e=>$('status').textContent=e.message);
$('open').onclick=async()=>{const button=$('open');button.disabled=true;try{if(!graph.nodes.some(n=>n.id==='source'))throw Error('请先载入实际源图');const platforms=$('sameRatio').checked?[{...specs[0],selected:false},{platform:'portrait_alt',label_zh:'另一竖屏 9:16',label_en:'Other portrait 9:16',ratio_id:'r_9_16',selected:true},...specs.slice(1)]:specs;const args=await runtime.prepareAppArgs({resource_uri:platformResizeUri,title:'实际图片平台适配',data:{image_id:'node/source',platforms,locale:$('locale').value}});const result=runtime.bindPreparedResult(prepareApp(args),args),trace={id:crypto.randomUUID(),name:'show_app',args,status:'done',result};chat.messages.push(trace);await save();render();}catch(e){$('status').textContent=e.message;}finally{button.disabled=false;}};
$('rerender').onclick=render;$('busy').onchange=render;$('locale').onchange=render;
$('undo').onclick=async()=>{if(!undo.length)return;graph=undo.pop();await save();await renderMedia();};
try {await openDatabase();const saved=await transaction('readonly',tx=>tx.objectStore('sessions').get('current'));if(saved){chat=saved.chat;graph=saved.graph;undo=saved.undo||[];}else await sample();await renderMedia();render();for(const id of ['file','sample','open','rerender','undo','busy','failGraph','failChat','sameRatio','locale'])$(id).disabled=false;}
catch(error){$('status').textContent='平台适配验收未就绪：'+error.message;}
window.addEventListener('pagehide',()=>{controller.reset();for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();database?.close();});
