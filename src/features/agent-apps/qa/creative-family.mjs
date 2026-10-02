import {createAppController} from '../integration.mjs';
import {launchManagerPicker} from '../../agent-manager/picker-launch.mjs';
const $=id=>document.getElementById(id),chat={id:'creative-family-qa',messages:[],queuedMessages:[]};let trace=null,streaming=false,failSave=false;
const getContext=()=>({chat,panelActive:true,pageLeaving:false,streaming,running:streaming});
const report=()=>{$('receipt').textContent=JSON.stringify({resource_uri:trace?.result.resource_uri,response:trace?.result.response,state:trace?.appState,queued:chat.queuedMessages,error:null},null,2);};
const controller=createAppController({getContext,onSaveState:async(_,record,state)=>{if(failSave)return false;record.appState=state;$('state').value=JSON.stringify(state,null,2);report();return true;},onQueuePrompt:async(text,record,_,metadata,isCurrent)=>{if(!isCurrent()||streaming||failSave)return false;if(!record.appHandoffs?.includes(metadata.handoffId)){chat.queuedMessages.push({text,widgetOrigin:{traceId:record.id,resourceUri:record.result.resource_uri,handoffId:metadata.handoffId},hidden:metadata.hidden});record.appHandoffs=[...(record.appHandoffs||[]),metadata.handoffId];}report();return true;},onError:error=>{$('receipt').textContent=error;}});
function render(){if(trace)$('card').replaceChildren(controller.render(trace));}
$('open').onclick=async()=>{try{trace=await launchManagerPicker({id:$('family').value,getContext,persist:async()=>!failSave});render();report();}catch(error){$('receipt').textContent=error.message;}};
$('busy').onclick=()=>{streaming=!streaming;$('busy').textContent='运行状态：'+(streaming?'运行中':'空闲');render();};
$('fail').onclick=()=>{failSave=!failSave;$('fail').textContent='保存状态：'+(failSave?'失败':'正常');};
$('reload').onclick=()=>{controller.reset();render();report();};
$('restore').onclick=()=>{try{if(!trace)throw Error('先打开入口');trace.appState=JSON.parse($('state').value);controller.reset();render();report();}catch(error){$('receipt').textContent=error.message;}};
