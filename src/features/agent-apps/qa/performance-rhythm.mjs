import {createAppController, prepareApp} from '../integration.mjs';
import {performanceRhythmUri} from '../performance-rhythm.mjs';
const status = document.getElementById('status'), cards = document.getElementById('cards'), reply = document.getElementById('reply'), busy = document.getElementById('busy');
// Exact domain example from the official _b constant; this is a scripted fixture.
const sample = {duration_ms:12000,scene:'她已经握住门把手。他先用玩笑挽留，随后停顿，把真正的告别吞了回去。',curve:[{id:'p1',at_ms:0,drive:24},{id:'p2',at_ms:2800,drive:58},{id:'p3',at_ms:6200,drive:36},{id:'p4',at_ms:9300,drive:86},{id:'p5',at_ms:12000,drive:42}],beats:[{id:'b1',at_ms:3000,kind:'emphasis',intensity:2,label:'别走'},{id:'b2',at_ms:5100,kind:'overlap',intensity:1,label:'抢着解释'},{id:'b3',at_ms:6500,kind:'pause',intensity:3,label:'吞回真话'},{id:'b4',at_ms:9300,kind:'emotion_turn',intensity:3,label:'改口祝福'},{id:'b5',at_ms:10700,kind:'action',intensity:2,label:'松开门把手'}],locale:'zh-CN'};
document.getElementById('input').value = JSON.stringify(sample, null, 2);
let database, chat = {messages: [], replies: []};
async function openDatabase() {
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tapnow-qa-performance-rhythm-v3',1);
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
function showReplies() {reply.value=chat.replies.map(item=>item.text).join('\n\n');status.textContent=`已保存${chat.messages.length}个官方表演节奏页；实际排队${chat.replies.length}次。未调用模型。`;}
const controller=createAppController({
  getContext:()=>({chat,panelActive:true,pageLeaving:false,streaming:busy.checked}),
  onSaveState:async(current,trace,state)=>{
    const previous=trace.appState;trace.appState=state;
    try {await save();} catch(error) {trace.appState=previous;status.textContent=error.message;throw error;}
  },
  onQueuePrompt:async(text,trace,current,metadata,isSourceCurrent=()=>true)=>{
    if(busy.checked||!isSourceCurrent())return false;
    if(metadata?.handoffId&&chat.replies.some(item=>item.traceId===trace.id&&item.handoffId===metadata.handoffId))return true;
    const previous=chat.replies,entry={traceId:trace.id,...metadata,text},next=[...previous,entry];chat.replies=next;
    let committed=false;
    try {await save();committed=true;if(busy.checked||!isSourceCurrent())throw Error('保存期间表演节奏页来源已切换或重载');}
    catch(error) {
      chat.replies=chat.replies===next?previous:chat.replies.filter(item=>item!==entry);
      if(committed){try{await save();}catch(failure){throw Error('验收交接撤销未能保存：'+failure.message);}}
      throw error;
    }
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
    const data=JSON.parse(document.getElementById('input').value), args={resource_uri:performanceRhythmUri,title:'雨夜告别 · 第18场',data};
    const trace={id:crypto.randomUUID(),name:'show_app',args,status:'done',result:prepareApp(args)},previous=chat.messages;
    chat.messages=[...previous,trace];try {await save();} catch(error) {chat.messages=previous;throw error;}render();
  } catch(error) {status.textContent=error.message;} finally {button.disabled=false;}
};
document.getElementById('rerender').onclick=render;busy.onchange=render;
try {
  await openDatabase();const saved=await read();
  if (saved!==undefined) {if(!saved||!Array.isArray(saved.messages)||!Array.isArray(saved.replies))throw Error('验收数据无效');chat=saved;}
  render();for(const id of ['open','rerender','busy'])document.getElementById(id).disabled=false;
} catch(error) {status.textContent=`验收页未就绪：${error.message}`;}
