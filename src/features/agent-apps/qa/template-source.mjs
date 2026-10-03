import {createAppController} from '../integration.mjs';
import {launchManagerPicker} from '../../agent-manager/picker-launch.mjs';
import {createTemplateSourceRuntime} from '../template-source-runtime.mjs';
import {createStore} from '../../agent-artifacts/store.mjs';
import {openHtmlPreview} from '../../agent-artifacts/html-preview.mjs';
import {createTemplateQaChatStore} from './template-source-chat-store.mjs';
const $=id=>document.getElementById(id),store=createStore({namespace:'tapnow-template-source-qa-v1'}),chatStore=createTemplateQaChatStore();
let chat=await chatStore.load();
// One-time read of this page's legacy key preserves an existing QA session.
// Do not delete or write any localStorage entries, including real user data.
if(!chat){try{chat=JSON.parse(localStorage.getItem('tapnow-template-source-qa-chat-v1'));}catch{}chat??={id:'template-source-qa',messages:[],queuedMessages:[]};await chatStore.save(chat);}
let trace=chat.messages.filter(item=>item.name==='show_app').at(-1),streaming=false,failSave=false;
const getContext=()=>({chat,panelActive:true,pageLeaving:false,streaming,running:streaming});
async function persist(){if(failSave)return false;return chatStore.save(chat);}
const runtime=createTemplateSourceRuntime({getContext,store,persistConversation:async()=>persist()});
async function report(extra){$('receipt').textContent=JSON.stringify({extra,description:trace?await runtime.describe(trace):null,saved_queue:chat.queuedMessages,artifacts:await store.list()},null,2);}
const controller=createAppController({getContext,templateSourceRuntime:runtime,onOpenTemplateArtifact:async metadata=>{const file=await store.get(metadata.artifact_path);openHtmlPreview({file,getCurrentFile:path=>store.get(path),isCurrent:()=>getContext().chat===chat,onError:message=>{void report(message);}});},onSaveState:async(_,record,state)=>{if(failSave)return false;record.appState=state;return persist();},onQueuePrompt:async(text,record,_,metadata,isCurrent)=>{if(!isCurrent()||streaming||failSave)return false;if(!record.appHandoffs?.includes(metadata.handoffId)){chat.queuedMessages.push({text,hidden:metadata.hidden,widgetOrigin:{traceId:record.id,callId:record.callId,resourceUri:record.result.resource_uri,handoffId:metadata.handoffId}});record.appHandoffs=[...(record.appHandoffs||[]),metadata.handoffId];}const saved=await persist();await report();return saved;},onError:message=>{void report(message);}});
function render(){if(trace)$('card').replaceChildren(controller.render(trace));}
$('open').onclick=async()=>{try{trace=await launchManagerPicker({id:$('family').value,getContext,persist:async()=>persist()});render();await report();}catch(error){await report(error.message);}};
$('mismatch').onclick=async()=>{try{if(!trace)throw Error('请先确认真实模板选择');await runtime.importFile(trace,new File(['<!doctype html><h1>不匹配原模板</h1>'],'mismatch.html',{type:'text/html'}));}catch(error){await report(error.message);}};
$('free').onclick=async()=>{try{const path='artifacts/free-creation.html',prior=(await store.list()).find(item=>item.artifact_path===path);const saved=await store.write({artifact_path:path,title:'自由 HTML 创作',content_type:'html',content:'<!doctype html><meta charset="utf-8"><h1>自由 HTML 创作，无原模板声明</h1>',expected_revision:prior?.revision||0});await report({free_saved:saved});}catch(error){await report(error.message);}};
$('busy').onclick=()=>{streaming=!streaming;$('busy').textContent='运行状态：'+(streaming?'运行中':'空闲');render();};$('fail').onclick=()=>{failSave=!failSave;$('fail').textContent='保存状态：'+(failSave?'失败':'正常');};
window.addEventListener('pagehide',()=>{controller.reset();runtime.dispose();chatStore.close();});render();await report();
