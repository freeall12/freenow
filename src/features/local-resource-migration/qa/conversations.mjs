import {createConversationMigration} from '../conversations.mjs';
import {hashSource} from '../index-format.mjs';
import {prepareActorEmotion,initialActorEmotionState,actorEmotionUri} from '../../agent-apps/actor-emotion.mjs';
import {createMcpAppCard} from '../../agent-apps/card.mjs';
import {createMcpAppHost} from '../../agent-apps/host.mjs';
import {appPolicy} from '../../agent-apps/registry.mjs';

const project=window.CanvasProjectContext.resolve(),conversations=window.CanvasProjectContext.createConversations({project,storage:localStorage,store:window.CanvasStore});
const known='https://qa-attachments.example.invalid/known.png?signature=qa-fixed',unknown='https://qa-attachments.example.invalid/unknown.png?signature=qa-fixed';
const index={version:1,algorithm:'sha256-exact-utf8',entries:{[await hashSource(known)]:{ref:'/assets/agent-casting.png',sha256:'d63945ac11cccff5ab24f9ca08479576f09d5c4d3a214dbdfd7c3278d82daf76',bytes:15288}}};
const actorKnown='https://qa-actor.example.invalid/reference.png?signature=exact-qa',actorUnknown=actorKnown+'&size=unindexed';
index.entries[await hashSource(actorKnown)]={...index.entries[await hashSource(known)]};
const status=document.querySelector('#status'),diagnostics=document.querySelector('#diagnostics'),previews=document.querySelector('#previews');
let live=null,lastReport=null,fetches=[],busy=false,renderVersion=0,actorCard=null;
const seed=()=>({chats:[{id:'qa-chat',title:'独立测试：非模型附件',text:'保留 QA 草稿',refs:['qa-node'],composerDoc:{text:'保留 QA 文档'},uploads:[{id:'qa-known',type:'image',name:'本机 PNG 测试样本',asset:known},{id:'qa-unknown',type:'image',name:'未知测试附件',asset:unknown}],messages:[{role:'user',text:'测试历史附件',uploads:[{id:'qa-message',type:'image',name:'历史消息测试样本',asset:known}]},{role:'tool',args:{url:known},appState:{image:known}}],queuedMessages:[{id:'qa-queued',text:'已暂停测试队列',uploads:[{id:'qa-queue-image',type:'image',name:'队列测试样本',asset:known}]}],queuePauseReason:'仅用于 QA，不会执行任务'}],activeId:'qa-chat'});
function controls(){document.querySelector('#initialize').disabled=busy;document.querySelector('#migrate').disabled=busy||!live;document.querySelector('#read').disabled=busy||!live;document.querySelector('#add-actor').disabled=busy||!live;}
async function show(){
 const version=++renderVersion;previews.replaceChildren();actorCard?.destroy();actorCard=null;document.querySelector('#actor-card').replaceChildren();if(!live)return;
 const chat=live.chats[0],items=[...(chat.uploads||[]),...chat.messages.flatMap(message=>message.uploads||[]),...chat.queuedMessages.flatMap(message=>message.uploads||[])];
 for(const item of items){
  const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=item.name+'：'+(item.asset.startsWith('asset:')?'正在解码本地附件':'待本地导入，未读取原地址');figure.append(caption);previews.append(figure);
  if(!item.asset.startsWith('asset:'))continue;
  try{const image=document.createElement('img');image.alt=item.name+'，独立非模型 QA 样本';image.src=await window.LocalAssets.url(item.asset);await image.decode();if(version!==renderVersion)return;figure.prepend(image);caption.textContent=item.name+'：真实解码 '+image.naturalWidth+' × '+image.naturalHeight;}
  catch(error){caption.textContent=item.name+'：本地解码失败（'+error.message+'）';}
 }
 const trace=chat.messages.find(message=>message.id==='qa-legacy-actor-preview');
 if(trace){actorCard=createMcpAppCard({trace,policy:appPolicy(actorEmotionUri),createHost:createMcpAppHost,isCurrent:()=>version===renderVersion&&live.chats[0].messages.includes(trace),hostOptions:{callbacks:{onError:message=>{document.querySelector('#actor-status').textContent='QA 官方面板：'+message;}}}});document.querySelector('#actor-card').append(actorCard.element);document.querySelector('#actor-status').textContent=trace.result.response.actor.reference_nodes[0].preview_url.startsWith('data:')?'已持久化本地预览；官方面板正在读取真实 PNG。未知参考仍待导入。':'旧卡远程测试预览尚未迁移；沙箱禁止读取原地址。';}
}
async function read(){live=await conversations.load();if(live)conversations.baseline(live.chats,live.activeId);await show();controls();return live;}
async function act(operation){busy=true;controls();try{await operation();}catch(error){lastReport=conversations.migrationStatus();status.textContent='操作失败：'+error.message+'；已提交：'+(error.persisted?'是':'否');diagnostics.textContent=JSON.stringify(lastReport,null,2);}finally{busy=false;controls();}}
document.querySelector('#initialize').onclick=()=>act(async()=>{await read();if(live){status.textContent='保留已有独立 QA 记录，没有覆盖测试草稿。';return;}live=seed();conversations.save(live.chats,live.activeId);await conversations.flush();await read();status.textContent='独立 QA 记录已持久化；原测试媒体地址尚未读取。';});
document.querySelector('#add-actor').onclick=()=>act(async()=>{
 if(live.chats[0].messages.some(message=>message.id==='qa-legacy-actor-preview')){status.textContent='已有 QA 旧人物卡保留，没有重复添加。';return;}
 const response=prepareActorEmotion({scene:'仅用于本地迁移验收的合成 QA 旧卡；不生成媒体，不执行工具。',mode:'image',source:{node_ref:'node/qa-source',media_kind:'image'},actor:{binding_id:'aem_0123456789abcdef',name:'独立 QA 人物',role:'本机 PNG 样本',reference_nodes:[{node_ref:'node/qa-known',preview_url:actorKnown},{node_ref:'node/qa-unknown',preview_url:actorUnknown}]},face:{valence:0,stance:0,intensity:50}},'QA 旧人物卡：只读预览');
 live.chats[0].messages.push({id:'qa-legacy-actor-preview',role:'tool',name:'show_app',status:'done',args:{resource_uri:actorEmotionUri},result:{kind:'mcp_app',resource_uri:actorEmotionUri,request:{title:'QA 旧人物参考'},response},appState:initialActorEmotionState(response),qaSynthetic:true});
 conversations.save(live.chats,live.activeId);await conversations.flush();await read();status.textContent='合成 QA 旧卡已保存；精确原 URL 只映射到本机 fixture，尚未执行迁移。';
});
document.querySelector('#migrate').onclick=()=>act(async()=>{
 lastReport=await conversations.migrateResources({getCurrent:()=>({chats:live.chats,activeId:live.activeId}),applyCommitted:value=>{live=value;},migrate:createConversationMigration({index,assets:window.LocalAssets,fetchImpl:async(ref,options)=>{if(ref!=='/assets/agent-casting.png')throw Error('QA 阻止了非本机素材读取');fetches.push(ref);return fetch(ref,options);}})});
 diagnostics.textContent=JSON.stringify({...lastReport,localReads:fetches.length,originalReads:0},null,2);status.textContent=`迁移报告：${lastReport.status}；${lastReport.summary?.changed||0} 项已迁移，${lastReport.summary?.unresolved||0} 项保留待导入；已提交：${lastReport.persisted?'是':'否'}`;await show();
});
document.querySelector('#read').onclick=()=>act(async()=>{await read();status.textContent='已重新读取独立数据库权威记录；下方图片由 LocalAssets 实际解码。';});
document.querySelector('#reload').onclick=()=>location.reload();
window.ConversationMigrationQA={read,migrateStatus:()=>lastReport,snapshot:()=>structuredClone(live),localReads:()=>[...fetches]};
await act(async()=>{await read();status.textContent=live?'已回读独立 QA 权威记录；本地图片正在实际解码。':'尚无独立 QA 记录，请先初始化测试。';});
