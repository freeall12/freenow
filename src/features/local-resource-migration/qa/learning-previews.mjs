import {createConversationMigration} from '../conversations.mjs';
import {hashSource} from '../index-format.mjs';
import {validateInteractiveLearningPreviewResponse} from '../interactive-learning-previews.mjs';
import {prepareInteractiveLearning,initialInteractiveLearningState,interactiveLearningUri} from '../../agent-apps/interactive-learning.mjs';
import {createMcpAppCard} from '../../agent-apps/card.mjs';
import {createMcpAppHost} from '../../agent-apps/host.mjs';
import {appPolicy} from '../../agent-apps/registry.mjs';
const placeholder='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const slots=['preview_url','learner_preview_url','contrast_url'],sources=slots.map((slot,i)=>`https://qa-learning.example.invalid/${slot}.png?signature=exact-qa-${i}`),unknown=sources[2]+'&size=unindexed';
const row={ref:'/assets/agent-casting.png',sha256:'d63945ac11cccff5ab24f9ca08479576f09d5c4d3a214dbdfd7c3278d82daf76',bytes:15288};
const index={version:1,algorithm:'sha256-exact-utf8',entries:Object.fromEntries(await Promise.all(sources.map(async source=>[await hashSource(source),{...row}])))};
const project=window.CanvasProjectContext.resolve(),conversations=window.CanvasProjectContext.createConversations({project,storage:localStorage,store:window.CanvasStore});
const status=document.getElementById('status'),cards=document.getElementById('cards'),diagnostics=document.getElementById('diagnostics');
let live=null,busy=true,version=0,rendered=[],lastReport=null,localReads=[];
function controls(){for(const id of ['initialize','add-known','add-unknown','migrate','read'])document.getElementById(id).disabled=busy||(id!=='initialize'&&!live);}
function seed(){return {chats:[{id:'qa-learning-chat',text:'保留独立QA草稿',messages:[],queuedMessages:[{id:'keep-queue',text:'保留暂停队列，不执行模型'}],queuePauseReason:'独立本地预览验收，禁止模型运行',interruptedRuns:[{journal:{submissionHash:'qa-keep-original-journal'}}]}],activeId:'qa-learning-chat'};}
function traceFixture(pending){
 const response=prepareInteractiveLearning({view:'board',locale:'zh-CN',level:{key:pending?'QA-PENDING':'QA-KNOWN',title:pending?'QA待导入旧卡':'QA三槽本地迁移',why:'合成显示样本，不评分或生成',media:'image',creator_prompt:'保留原提示词：此图片仅为显示验收样本',preview_url:placeholder,learner_preview_url:placeholder,contrast_url:placeholder,questions:{q2:{stem:'哪个词说明光线？',options:[{text:'逆光',correct:true},{text:'低角度',correct:false}],explain:'仅为本地交互样例'},q3:{parts:['主体',''],blanks:['逆光'],bank:['逆光','低角度']},q4:{stem:'本QA不点评或生成'},q5:{stem:'本QA不点评或生成'}},hints:{q4:['此为显示样本'],q5:['此为显示样本']}}});
 const appState=initialInteractiveLearningState(response);appState.drafts={q4:'保留原反推草稿',q5:'保留原改编草稿'};appState.done=['q1'];
 const original=sources.map((source,i)=>pending&&i===2?unknown:source);slots.forEach((slot,i)=>{response.level[slot]=original[i];});
 return {id:pending?'qa-learning-pending':'qa-learning-known',role:'tool',name:'show_app',status:'done',args:{resource_uri:interactiveLearningUri,data:{level:{preview_url:original[0]},source:'保留合成QA原调用'}},result:{kind:'mcp_app',resource_uri:interactiveLearningUri,response,sourceContext:{projectId:project.id,fingerprint:'qa-keep-original-source'}},appState,appHandoffs:['qa-keep-original-handoff'],generationTask:{id:'qa-no-real-task'},qaSynthetic:true};
}
async function show(){
 const current=++version;rendered.forEach(card=>card.destroy());rendered=[];cards.replaceChildren();if(!live)return;
 for(const trace of live.chats[0].messages){
  const section=document.createElement('section'),title=document.createElement('h3'),note=document.createElement('p');title.textContent=trace.result.response.level.title;section.append(title,note);cards.append(section);
  try{validateInteractiveLearningPreviewResponse(trace.result.response);}catch{note.textContent='预览尚未完整导入；原记录保留，未向图片或官方 iframe 提供远程 URL。';continue;}
  const dimensions=[];for(const slot of slots){const image=new Image();image.src=trace.result.response.level[slot];await image.decode();if(current!==version)return;dimensions.push(`${slot}=${image.naturalWidth}×${image.naturalHeight}`);}
  note.textContent='已回读并真实解码三个本地预览：'+dimensions.join('；')+'。下方官方页只读显示，未配置工具/队列回调。';
  const card=createMcpAppCard({trace,policy:appPolicy(interactiveLearningUri),createHost:createMcpAppHost,hostOptions:{isCurrent:()=>current===version&&live.chats[0].messages.includes(trace),callbacks:{onError:message=>{note.textContent='官方页显示错误：'+message;}}}});rendered.push(card);section.append(card.element);
 }
}
async function read(){live=await conversations.load();if(live)conversations.baseline(live.chats,live.activeId);await show();}
async function act(operation){busy=true;controls();try{await operation();}catch(error){lastReport=conversations.migrationStatus();status.textContent='操作失败：'+error.message;diagnostics.textContent=JSON.stringify(lastReport,null,2);}finally{busy=false;controls();}}
document.getElementById('initialize').onclick=()=>act(async()=>{await read();if(live){status.textContent='保留已有独立QA记录，没有覆盖草稿或旧卡。';return;}live=seed();conversations.save(live.chats,live.activeId);await conversations.flush();await read();status.textContent='独立权威会话已持久保存。';});
for(const [id,pending]of [['add-known',false],['add-unknown',true]])document.getElementById(id).onclick=()=>act(async()=>{const trace=traceFixture(pending);if(live.chats[0].messages.some(item=>item.id===trace.id)){status.textContent='已有相同合成QA旧卡，保持原记录。';return;}live.chats[0].messages.push(trace);conversations.save(live.chats,live.activeId);await conversations.flush();await read();status.textContent='合成旧学习卡已保存；原URL尚未读取。';});
document.getElementById('migrate').onclick=()=>act(async()=>{
 lastReport=await conversations.migrateResources({getCurrent:()=>live,applyCommitted:value=>{live=value;},migrate:createConversationMigration({index,assets:window.LocalAssets,fetchImpl:async(ref,options)=>{if(ref!==row.ref)throw Error('QA阻止非本机素材读取');localReads.push(ref);return fetch(ref,options);}})});
 diagnostics.textContent=JSON.stringify({...lastReport,localReads:localReads.length,remoteReads:0},null,2);status.textContent=`迁移状态：${lastReport.status}；${lastReport.summary?.changed||0}槽已迁移，${lastReport.summary?.unresolved||0}槽待导入；实际提交：${lastReport.persisted?'是':'否'}`;await show();
});
document.getElementById('read').onclick=()=>act(async()=>{await read();status.textContent='已回读数据库权威记录；本地预览真实解码，草稿/交接/任务身份保留。';});document.getElementById('reload').onclick=()=>location.reload();
window.LearningPreviewMigrationQA={snapshot:()=>structuredClone(live),report:()=>lastReport,localReads:()=>[...localReads]};
await act(async()=>{await read();status.textContent=live?'已回读独立权威记录。':'尚无独立QA记录，请先初始化。';});
