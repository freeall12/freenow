import {createAppController, prepareApp} from '../integration.mjs';
import {interactiveLearningUri, initialInteractiveLearningState} from '../interactive-learning.mjs';
const status=document.getElementById('status'),cards=document.getElementById('cards'),reply=document.getElementById('reply'),busy=document.getElementById('busy'),failSave=document.getElementById('fail-save'),input=document.getElementById('input');
// Local exercise data for deterministic interaction QA; no fabricated image or
// model result is supplied as a target/reference.
const board={view:'board',locale:'zh-CN',level:{key:'L1.1',title:'逆光与主体',why:'练习光线与构图的提示词表达',media:'image',node_title:'本地练习（本页未提供目标图）',creator_prompt:'雨后街道，人物逆光，暖色轮廓，低角度镜头',params:'画幅16:9',retries:2,questions:{q2:{stem:'哪个词控制轮廓光？',options:[{text:'逆光',correct:true},{text:'低角度',correct:false}],explain:'逆光描述光线与主体的相对位置'},q3:{parts:['人物','，','镜头'],blanks:['逆光','低角度'],bank:['逆光','低角度','高角度']},q4:{stem:'写下反推答案；此示例没有目标图，请不要声称观察了图片'},q5:{stem:'将人物换成骑车的人，保留光线与构图',formula:'主体 + 光线 + 构图'}},hints:{q2:['观察主体边缘光的位置'],q3:['分别考虑光线和相机位置'],q4:['描述可确认的技法；没有图片时说明限制'],q5:['替换主体后保留逆光与低角度']}}};
const syllabus={view:'syllabus',locale:'zh-CN',course:{title:'本地光线练习',creator:'确定性练习来源',total_nodes:2},chapters:[{label:'第一章 · 光线',locked:false,levels:[{key:'L1.1',title:'逆光与主体',why:'辨认光线与构图',state:'current',done_questions:[]}]},{label:'第二章 · 色彩',locked:true,levels:[{key:'L2.1',title:'冷暖对照',why:'完成上一章后继续',state:'locked',done_questions:[]}]}]};
input.value=JSON.stringify(board,null,2);
let database,chat={messages:[],replies:[]},savingState=false,queueSaving=false;
async function openDatabase() {
  database=await new Promise((resolve,reject)=>{const request=indexedDB.open('tapnow-qa-interactive-learning-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('sessions');request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(request.error||Error('验收存储未能打开'));request.onblocked=()=>reject(Error('验收存储被旧页面阻塞'));});
}
function read() {
  return new Promise((resolve,reject)=>{const transaction=database.transaction('sessions','readonly'),request=transaction.objectStore('sessions').get('current');transaction.oncomplete=()=>resolve(request.result);transaction.onerror=transaction.onabort=()=>reject(transaction.error||request.error||Error('验收读取失败'));});
}
function save() {
  if(failSave.checked)return Promise.reject(Error('模拟互动学习存储提交失败'));
  const snapshot=structuredClone(chat);
  return new Promise((resolve,reject)=>{const transaction=database.transaction('sessions','readwrite');transaction.objectStore('sessions').put(snapshot,'current');transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(transaction.error||Error('验收保存失败'));});
}
function showReplies() {
  reply.value=chat.replies.map(item=>item.text).join('\n\n');status.textContent=`已保存${chat.messages.length}个官方学习页；实际排队${chat.replies.length}次。未调用模型。`;
  document.getElementById('saved-state').textContent=chat.messages.map(trace=>{const state=trace.appState;return `${trace.result.response.view} / ${trace.result.response.level?.key||trace.result.response.course?.title}：${state?`已提交 ${state.done.length}/5 题，q4草稿${state.drafts.q4?.length||0}字，q5草稿${state.drafts.q5?.length||0}字`:'目录无需编辑状态'}`;}).join('\n');
}
const controller=createAppController({
  getContext:()=>({chat,panelActive:true,pageLeaving:false,streaming:busy.checked}),
  onSaveState:async(current,trace,state)=>{
    if(current!==chat||savingState||queueSaving)throw Error('互动学习正在保存，请稍后重试');
    const previous=trace.appState;trace.appState=state;savingState=true;
    try{await save();showReplies();}catch(error){trace.appState=previous;status.textContent=error.message;throw error;}finally{savingState=false;}
  },
  onQueuePrompt:async(text,trace,current,metadata,isSourceCurrent=()=>true)=>{
    if(current!==chat||busy.checked||savingState||queueSaving||!isSourceCurrent())return false;
    if(metadata?.handoffId&&chat.replies.some(item=>item.traceId===trace.id&&item.handoffId===metadata.handoffId))return true;
    const previous=chat.replies,entry={traceId:trace.id,...metadata,text},next=[...previous,entry];chat.replies=next;
    let committed=false;queueSaving=true;
    try{await save();committed=true;if(busy.checked||!isSourceCurrent())throw Error('保存期间互动学习页来源已切换或重载');}
    catch(error){chat.replies=chat.replies===next?previous:chat.replies.filter(item=>item!==entry);if(committed){try{await save();}catch(failure){throw Error('验收交接撤销未能保存：'+failure.message);}}throw error;}
    finally{queueSaving=false;}
    showReplies();return true;
  },
  onError:message=>{status.textContent=message;},
});
function render() {controller.prune(chat.messages);for(const trace of chat.messages){const element=controller.render(trace);if(element&&element.parentElement!==cards)cards.append(element);}showReplies();}
document.getElementById('board').onclick=()=>{input.value=JSON.stringify(board,null,2);};document.getElementById('syllabus').onclick=()=>{input.value=JSON.stringify(syllabus,null,2);};
document.getElementById('open').onclick=async()=>{
  const button=document.getElementById('open');button.disabled=true;
  try {
    if(savingState||queueSaving)throw Error('互动学习正在保存，请稍后重试');
    const data=JSON.parse(input.value),args={resource_uri:interactiveLearningUri,title:data.view==='syllabus'?'本地学习目录':'本地互动学习板',data},trace={id:crypto.randomUUID(),name:'show_app',args,status:'done',result:prepareApp(args)},previous=chat.messages;
    const initial=initialInteractiveLearningState(trace.result.response);if(initial)trace.appState=initial;
    chat.messages=[...previous,trace];try{await save();}catch(error){chat.messages=previous;throw error;}render();
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
document.getElementById('rerender').onclick=render;busy.onchange=render;
try{await openDatabase();const saved=await read();if(saved!==undefined){if(!saved||!Array.isArray(saved.messages)||!Array.isArray(saved.replies))throw Error('验收数据无效');chat=saved;}render();for(const id of ['open','board','syllabus','rerender','busy','fail-save'])document.getElementById(id).disabled=false;}
catch(error){status.textContent=`验收页未就绪：${error.message}`;}
