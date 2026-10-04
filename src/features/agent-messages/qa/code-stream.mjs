import {createMessageRenderer} from '../messages.mjs';
import {renderMessageMarkdown} from '../../../../assets/agent-editor.js';
const mount=document.querySelector('#mount'),receipt=document.querySelector('#receipt'),paste=document.querySelector('#paste');let message=null,row=null,timer=null,sequence=0,lastIdentity=null;
const renderer=createMessageRenderer({renderMarkdown:renderMessageMarkdown,onError:error=>receipt.textContent=error,onFeedback(){},onFork(){}});
function report(){const code=mount.querySelector('code'),toolbar=mount.querySelector('.agent-code-actions');receipt.textContent=JSON.stringify({status:message?.stream?.status||'empty',sequence,sameCode:lastIdentity?lastIdentity.code===code:null,sameToolbar:lastIdentity?lastIdentity.toolbar===toolbar:null,wrap:mount.querySelector('.chat-code-block')?.dataset.wrap||null,focus:document.activeElement?.getAttribute('aria-label'),actualCode:code?.textContent||'',pastedClipboard:paste.value,codeButtons:toolbar?.querySelectorAll('button').length||0,messageActions:mount.querySelector('.agent-message-actions')?.querySelectorAll('button').length||0},null,2);}
function update(){if(!row||!message)return;lastIdentity={code:mount.querySelector('code'),toolbar:mount.querySelector('.agent-code-actions')};renderer.updateStreaming(row,message,{busy:message.stream.status==='streaming'});sequence++;report();}
function append(){if(message?.stream.status!=='streaming')return;message.text+='\nconst track_'+sequence+' = { y: -0.123456789, description: "持续新增的中文代码用于核对实时复制与横向滚动" };';update();}
function stopTimer(){clearTimeout(timer);timer=null;}
document.querySelector('#start').onclick=()=>{stopTimer();renderer.reset();message={role:'assistant',text:'这是固定验收文本。\n\n```js\nconst camera = { x: 2.375, description: "一段较长的中文代码用于验证取消换行后横向滚动仍被保留" };',stream:{status:'streaming'}};row=renderer.render(message,{key:'qa-code-stream:'+sequence++,index:0,lastAssistant:true,busy:true});mount.replaceChildren(row);lastIdentity=null;paste.value='';report();};
document.querySelector('#append').onclick=append;
document.querySelector('#timed').onclick=()=>{stopTimer();const expected=row;timer=setTimeout(()=>{timer=null;if(row===expected)append();},1000);};
document.querySelector('#finish').onclick=()=>{if(!message)return;stopTimer();message.text+='\n```\n\n已收到本次固定测试回复。';message.stream.status='done';update();};
document.querySelector('#switch').onclick=()=>{stopTimer();renderer.reset();message=null;row=null;mount.replaceChildren();lastIdentity=null;report();};
paste.oninput=report;mount.addEventListener('click',()=>setTimeout(report,0));mount.addEventListener('focusin',report);
window.addEventListener('pagehide',()=>{stopTimer();renderer.destroy();},{once:true});
