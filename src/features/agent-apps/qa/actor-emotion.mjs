import {createAppController, prepareApp} from '../integration.mjs';
import {actorEmotionUri} from '../actor-emotion.mjs';
import {createActorGuideRuntime} from '../actor-guide-runtime.mjs';
const status=document.getElementById('status'),cards=document.getElementById('cards'),reply=document.getElementById('reply'),guides=document.getElementById('guides'),busy=document.getElementById('busy');
// A clearly labelled local fixture. This is the input reference image, never a
// replacement for the official page's actual rendered expression-guide pixels.
function fixtureImage() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#343434';ctx.fillRect(0,0,512,512);ctx.fillStyle='#9a9997';ctx.beginPath();ctx.ellipse(256,232,96,130,0,0,2*Math.PI);ctx.fill();
  ctx.fillStyle='#737270';ctx.beginPath();ctx.ellipse(256,448,168,128,0,0,2*Math.PI);ctx.fill();ctx.fillStyle='#343434';ctx.fillRect(214,221,22,7);ctx.fillRect(276,221,22,7);ctx.fillRect(234,291,44,4);
  ctx.fillStyle='#eee';ctx.font='18px sans-serif';ctx.fillText('QA INPUT FIXTURE',164,40);return canvas.toDataURL('image/png');
}
const image=fixtureImage(),sample={mode:'image',locale:'zh-CN',scene:'验收场景：人物将告别藏在平静表情里。',source:{node_ref:'node/qa-source',media_kind:'image'},actor:{binding_id:'aem_0123456789abcdef',name:'验收人物',role:'脚本验收输入',reference_nodes:[{node_ref:'node/qa-actor'}]},face:{valence:-65,stance:-65,intensity:68}};
document.getElementById('input').value=JSON.stringify(sample,null,2);
let database,chat={id:'qa-actor-emotion-chat',messages:[],replies:[]},graph={nodes:[{id:'qa-source',type:'image',title:'QA source fixture',image,fullImage:image,x:0,y:0,width:320,height:320},{id:'qa-actor',type:'image',title:'QA actor fixture',image,fullImage:image,x:400,y:0,width:320,height:320}],edges:[]};
async function openDatabase() {
  database=await new Promise((resolve,reject)=>{const request=indexedDB.open('tapnow-qa-actor-emotion-v1',1);request.onupgradeneeded=()=>{request.result.createObjectStore('sessions');request.result.createObjectStore('assets');};request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('验收存储被旧页面阻塞'));});
}
function read(store,key) {return new Promise((resolve,reject)=>{const transaction=database.transaction(store,'readonly'),request=transaction.objectStore(store).get(key);transaction.oncomplete=()=>resolve(request.result);transaction.onerror=transaction.onabort=()=>reject(transaction.error||request.error||Error('验收读取失败'));});}
async function write(store,key,value) {
  // Fault controls apply only to this page's labelled QA session adapter. Real
  // production persistence and the captured iframe are never replaced.
  if(store==='sessions'){
    if(document.getElementById('save-delay').checked)await new Promise(resolve=>setTimeout(resolve,800));
    if(document.getElementById('save-failure').checked)throw Error('验收会话保存失败');
  }
  return new Promise((resolve,reject)=>{const transaction=database.transaction(store,'readwrite');transaction.objectStore(store).put(value,key);transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(transaction.error||Error('验收事务提交失败'));});
}
function save() {return write('sessions','current',structuredClone({chat,graph}));}
const assetUrls=new Map(),localAssets={
  async put(blob) {const id='asset:'+crypto.randomUUID();await write('assets',id,blob);return id;},
  async url(id) {if(/^(?:https?:|blob:|data:image\/)/.test(id))return id;if(assetUrls.has(id))return assetUrls.get(id);const blob=await read('assets',id);if(!(blob instanceof Blob))throw Error('真实验收图片未保存');const url=URL.createObjectURL(blob);assetUrls.set(id,url);return url;},
};
function decodeImage(url,{signal}={}) {return new Promise((resolve,reject)=>{const image=new Image(),cleanup=()=>signal?.removeEventListener('abort',abort),abort=()=>{image.src='';cleanup();reject(signal.reason||Error('验收解码已取消'));};image.onload=()=>{cleanup();resolve({width:image.naturalWidth,height:image.naturalHeight});};image.onerror=()=>{cleanup();reject(Error('真实表情图片解码失败'));};if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});image.src=url;});}
const runtime=createActorGuideRuntime({app:{getState:()=>graph,createConnected:(sourceId,patches)=>patches.map(patch=>{const source=graph.nodes.find(item=>item.id===sourceId);if(!source)throw Error('验收源节点已失效');const node={...patch,id:crypto.randomUUID(),x:(source.x||0)+400,y:source.y||0};graph.nodes.push(node);graph.edges.push({id:crypto.randomUUID(),source:sourceId,target:node.id});return node;})},localAssets,store:{save:async()=>{await save();return true;},flush:async()=>{}},getProjectId:()=> 'qa-actor-emotion-project',persistConversation:save,decodeImage});
function showReplies() {reply.value=chat.replies.map(item=>item.text).join('\n\n');status.textContent=`已提交${chat.messages.length}个官方情绪页；实际灰模参考${graph.nodes.filter(item=>item.provenance?.kind==='actor-expression-guide').length}张；实际排队${chat.replies.length}次。未调用模型。`;}
async function showGuides() {guides.replaceChildren();for(const node of graph.nodes.filter(item=>item.provenance?.kind==='actor-expression-guide')){const figure=document.createElement('figure'),image=document.createElement('img'),label=document.createElement('figcaption');image.src=await localAssets.url(node.fullImage);image.width=image.height=160;image.alt='官方灰模实际已保存表情参考';label.textContent=node.provenance.guide.node_ref+'\n'+node.provenance.guide.guide_sha256;figure.append(image,label);guides.append(figure);}}
const controller=createAppController({
  getContext:()=>({chat,panelActive:true,pageLeaving:false,streaming:busy.checked}),
  getActorSourceContext:(data,trace,current)=>runtime.capture(data,{trace,chat:current,isCurrent:()=>current===chat&&chat.messages.includes(trace)&&!busy.checked}),
  onSaveExpressionGuide:async(args,trace,current,options)=>{const receipt=await runtime.save(args,trace,current,options);await showGuides();showReplies();return receipt;},
  onSaveState:async(current,trace,state)=>{const previous=trace.appState;trace.appState=state;try{await save();}catch(error){trace.appState=previous;throw error;}},
  onQueuePrompt:async(text,trace,current,metadata,isSourceCurrent=()=>true)=>{
    if(busy.checked||!isSourceCurrent())return false;
    if(metadata?.handoffId&&chat.replies.some(item=>item.traceId===trace.id&&item.handoffId===metadata.handoffId))return true;
    const previous=chat.replies,entry={traceId:trace.id,...metadata,text},next=[...previous,entry];chat.replies=next;let committed=false;
    try{await save();committed=true;if(busy.checked||!isSourceCurrent())throw Error('保存期间官方情绪页来源已切换或重载');}
    catch(error){chat.replies=chat.replies===next?previous:chat.replies.filter(item=>item!==entry);if(committed)await save();throw error;}
    showReplies();return true;
  },onError:message=>{status.textContent=message;},
});
function render() {controller.prune(chat.messages);for(const trace of chat.messages){const element=controller.render(trace);if(element&&element.parentElement!==cards)cards.append(element);}showReplies();}
document.getElementById('open').onclick=async()=>{const button=document.getElementById('open');button.disabled=true;try{const data=JSON.parse(document.getElementById('input').value),args={resource_uri:actorEmotionUri,title:'人物情绪 · 官方页面验收',data},prepared=await runtime.prepareAppArgs(args,{isCurrent:()=>!busy.checked}),trace={id:crypto.randomUUID(),name:'show_app',args,status:'done',result:runtime.bindPreparedResult(prepareApp(prepared),prepared)},previous=chat.messages;chat.messages=[...previous,trace];try{await save();}catch(error){chat.messages=previous;throw error;}render();}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
function readVideoMetadata(url) {
  return new Promise((resolve,reject)=>{
    const video=document.createElement('video');let timer;
    const finish=(error)=>{clearTimeout(timer);video.onloadedmetadata=video.onerror=null;const metadata={width:video.videoWidth,height:video.videoHeight,duration:video.duration};video.removeAttribute('src');video.load();if(error)reject(error);else if(!metadata.width||!metadata.height||!Number.isFinite(metadata.duration)||metadata.duration<=0)reject(Error('视频样例没有可用的真实视频元数据'));else resolve(metadata);};
    video.preload='metadata';video.muted=true;video.onloadedmetadata=()=>finish();video.onerror=()=>finish(Error('真实本地视频 /qa/trim-scenes.mp4 无法读取'));
    timer=setTimeout(()=>finish(Error('本地视频元数据读取超时')),15000);video.src=url;video.load();
  });
}
document.getElementById('video-sample').onclick=async()=>{
  const button=document.getElementById('video-sample'),openButton=document.getElementById('open');button.disabled=openButton.disabled=true;button.textContent='正在读取真实视频…';
  try {
    if(busy.checked)throw Error('请先结束模拟会话运行，再准备视频样例');
    const reference=graph.nodes.find(node=>node.id==='qa-actor'&&node.type==='image'&&(node.fullImage||node.image));
    if(!reference)throw Error('既有真实人物参考图片不存在，不能准备视频样例');
    const videoUrl=new URL('/qa/trim-scenes.mp4',location.href).href,metadata=await readVideoMetadata(videoUrl),id='qa-video-'+crypto.randomUUID();
    if(busy.checked)throw Error('读取视频期间会话已开始运行');
    const cover=reference.fullImage||reference.image,node={id,type:'video',title:'QA real video source',video:videoUrl,image:cover,poster:cover,videoMetadata:metadata,pixelWidth:metadata.width,pixelHeight:metadata.height,x:800,y:0,width:320,height:320*metadata.height/metadata.width};
    graph.nodes.push(node);
    try {await save();} catch(error) {graph.nodes=graph.nodes.filter(item=>item!==node);throw error;}
    const videoSample={mode:'video',locale:'zh-CN',scene:'视频验收场景：人物忍住泪水，用温柔且克制的语气说出告别。',source:{node_ref:'node/'+id,media_kind:'video'},actor:{binding_id:'aem_0123456789abcdef',name:'验收人物',role:'脚本验收输入',reference_nodes:[{node_ref:'node/'+reference.id}]},face:{valence:-65,stance:-65,intensity:68},voice:{preset:'tender',intensity:36},dialogue:'我们就到这里吧。愿你以后都好。'};
    document.getElementById('input').value=JSON.stringify(videoSample,null,2);status.textContent=`真实视频源已保存：${metadata.width}×${metadata.height}，${metadata.duration.toFixed(2)}秒。已填入视频/声音样例，请点击“打开官方人物情绪页”。`;
  } catch(error) {status.textContent=error.message;} finally {button.textContent='视频模式样例';button.disabled=openButton.disabled=false;}
};
document.getElementById('rerender').onclick=render;busy.onchange=render;
window.addEventListener('pagehide',()=>{controller.reset();for(const url of assetUrls.values())URL.revokeObjectURL(url);database?.close();});
try{await openDatabase();const saved=await read('sessions','current');if(saved!==undefined){if(!saved?.chat||!Array.isArray(saved.chat.messages)||!Array.isArray(saved.chat.replies)||!Array.isArray(saved.graph?.nodes)||!Array.isArray(saved.graph.edges))throw Error('验收存储无效');chat=saved.chat;graph=saved.graph;}render();await showGuides();for(const id of ['open','video-sample','rerender','busy'])document.getElementById(id).disabled=false;}catch(error){status.textContent='验收页未就绪：'+error.message;}
