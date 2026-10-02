import {createAppController, prepareApp} from '../integration.mjs';
import {storyRoomUri,initialStoryRoomState} from '../story-room.mjs';
const status = document.getElementById('status'), cards = document.getElementById('cards'), reply = document.getElementById('reply'), busy = document.getElementById('busy');
// Deterministic local fixture using the fields rendered by the packaged board.
const sample={locale:'zh-CN',acts:[{id:'A1',label:'第一幕 · 事故以后'},{id:'A2',label:'第二幕 · 真相'}],plotlines:[{id:'P1',label:'林岚',color:'teal'},{id:'P2',label:'事故调查',color:'amber'}],scenes:[{key:'S1',act:'A1',name:'医院走廊',cast:['林岚'],plotline:'P1',story_order:3,story_time:'事故后',loc:'医院',synopsis:'林岚在口袋里发现旧票根。',beat:'发现',has_body:true},{key:'S2',act:'A1',name:'车站告别',cast:['林岚','调查员'],plotline:'P2',story_order:1,story_time:'事故前',loc:'车站',synopsis:'调查员的回答与票根时间不符。',has_body:false},{key:'S3',act:'A2',name:'天台',cast:['林岚'],plotline:'P1',story_order:4,story_time:'事故后',loc:'天台',synopsis:'林岚决定核对事故当天的记录。',has_body:true}],causal_links:[{from:'S2',to:'S1'}]};
document.getElementById('input').value = JSON.stringify(sample, null, 2);
let savingState=false,queueSaving=false;
let database, chat = {messages: [], replies: []};
async function openDatabase() {
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tapnow-qa-story-room-v1',1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => {request.result.onversionchange = () => request.result.close();resolve(request.result);};
    request.onerror = () => reject(request.error || Error('验收存储未能打开'));
    request.onblocked = () => reject(Error('验收存储被旧页面阻塞'));
  });
}
function read() {
  return new Promise((resolve,reject) => {
    const transaction=database.transaction('sessions','readonly'), request=transaction.objectStore('sessions').get('current');
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onerror=transaction.onabort=()=>reject(transaction.error||request.error||Error('验收读取失败'));
  });
}
function save() {
  const snapshot=structuredClone(chat);
  return new Promise((resolve,reject) => {
    const transaction=database.transaction('sessions','readwrite');transaction.objectStore('sessions').put(snapshot,'current');
    transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(transaction.error||Error('验收保存失败'));
  });
}
function showReplies() {reply.value=chat.replies.map(item=>item.text).join('\n\n');status.textContent=`已保存${chat.messages.length}个官方剧本结构页；实际排队${chat.replies.length}次。未调用模型。`;}
const controller=createAppController({
  getContext:()=>({chat,panelActive:true,pageLeaving:false,streaming:busy.checked}),
  onSaveState:async(current,trace,state)=>{
    if(savingState||queueSaving)throw Error('剧本结构正在保存，请稍后重试');
    const previous=trace.appState;trace.appState=state;savingState=true;
    try {await save();} catch(error) {trace.appState=previous;status.textContent=error.message;throw error;} finally {savingState=false;}
  },
  onQueuePrompt:async(text,trace,current,metadata,isSourceCurrent=()=>true)=>{
    if(busy.checked||savingState||queueSaving||!isSourceCurrent())return false;
    if(metadata?.handoffId&&chat.replies.some(item=>item.traceId===trace.id&&item.handoffId===metadata.handoffId))return true;
    const previous=chat.replies,entry={traceId:trace.id,...metadata,text},next=[...previous,entry];chat.replies=next;
    let committed=false;queueSaving=true;
    try {await save();committed=true;if(busy.checked||!isSourceCurrent())throw Error('保存期间剧本结构页来源已切换或重载');}
    catch(error) {
      chat.replies=chat.replies===next?previous:chat.replies.filter(item=>item!==entry);
      if(committed){try{await save();}catch(failure){throw Error('验收交接撤销未能保存：'+failure.message);}}
      throw error;
    } finally {queueSaving=false;}
    showReplies();return true;
  },
  onError:message=>{status.textContent=message;},
});
function render() {
  controller.prune(chat.messages);
  for (const trace of chat.messages) {
    const element=controller.render(trace);if(element&&element.parentElement!==cards)cards.append(element);
  }
  showReplies();
}
document.getElementById('open').onclick=async()=>{
  const button=document.getElementById('open');button.disabled=true;
  try {
    const data=JSON.parse(document.getElementById('input').value), args={resource_uri:storyRoomUri,title:'事故与回忆 · 剧本结构',data};
    const trace={id:crypto.randomUUID(),name:'show_app',args,status:'done',result:prepareApp(args)},previous=chat.messages;
    // The original page does not save on initial confirmation; persist its exact
    // initial state with the trace so a direct unchanged adoption is verifiable.
    trace.appState=initialStoryRoomState(trace.result.response);
    chat.messages=[...previous,trace];try {await save();} catch(error) {chat.messages=previous;throw error;}render();
  } catch(error) {status.textContent=error.message;} finally {button.disabled=false;}
};
document.getElementById('rerender').onclick=render;busy.onchange=render;
try {
  await openDatabase();const saved=await read();
  if (saved!==undefined) {if(!saved||!Array.isArray(saved.messages)||!Array.isArray(saved.replies))throw Error('验收数据无效');chat=saved;}
  render();for(const id of ['open','rerender','busy'])document.getElementById(id).disabled=false;
} catch(error) {status.textContent=`验收页未就绪：${error.message}`;}
