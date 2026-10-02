import {createComposerEditor,referenceNodes} from '../../../assets/agent-editor.js';
import {createAddMenu} from '../agent-attachments/menu.mjs';
import {attachmentStrip} from '../agent-attachments/uploads.mjs';
import {studioComposer} from './composer-channel.mjs';
import {createTypingPlaceholder} from './typing-placeholder.mjs';
import {createControl as confirmControl} from '../agent-composer/confirmation.mjs';
import {createControl as modelControl,observeFooter} from '../agent-composer/models.mjs';
import {el,button} from '../studio-v2/dom.mjs';

export function createStudioComposer({nodeId,onError,onState,beforeOpen}){
  const element=el('div','studio-v2-composer'),editor=el('div','studio-v2-editor');
  const input=el('div','studio-v2-input');editor.append(input);element.append(editor);
  const placeholder=createTypingPlaceholder({input,mount:editor});
  const footer=el('div','agent-composer-footer'),left=el('div','agent-footer-left'),right=el('div','agent-footer-right'),actions=el('div','agent-footer-actions');
  let state=null,model=null,confirmation=null,layout=null,controlsKey='',disposed=false;
  const run=fn=>()=>{try{fn();}catch(error){onError(error.message);}};
  const attachment=button('添加','添加',null,'agent-add');
  const menu=createAddMenu({trigger:attachment,onAction:action=>window.AgentUI.attachmentAction(action,nodeId,attachment),getSkills:()=>window.AgentUI.attachmentSkills(),onSkill:name=>window.AgentUI.selectAttachmentSkill(name,nodeId),onError});
  let strip=null,stripKey='';
  const voice=button('语音输入','语音输入已升级，免费体验，极速丝滑',null,'agent-voice');
  const send=button('发送','发送',run(()=>studioComposer.submit(nodeId)),'agent-send');
  actions.append(voice,send);right.append(actions);left.append(attachment);footer.append(left,right);element.append(footer);
  const rich=createComposerEditor({element:input,value:studioComposer.read(nodeId)?.session||{id:nodeId,text:''},label:'描述场景与镜头',onChange:snapshot=>{try{studioComposer.write(nodeId,snapshot);}catch(error){onError(error.message);}placeholder.sync();},onSubmit:run(()=>studioComposer.submit(nodeId))});
  window.VoiceInput.bind(voice,{target:rich.dom,getValue:()=>rich.getText(),setValue:value=>rich.setText(value),mount:element,isCurrent:()=>!disposed&&!state?.blocked});
  const unsubscribe=studioComposer.subscribe(nodeId,next=>{
    state=next;const keyAttachments=JSON.stringify([next?.session.uploads,next?.session.refs]);if(keyAttachments!==stripKey){stripKey=keyAttachments;strip?.remove();const session=next?.session;if(session){const refs=(session.refs||[]).filter(id=>id!==nodeId&&!referenceNodes(session.composerDoc).some(ref=>ref.kind==='node'&&ref.id===id)).map(id=>window.CanvasApp.getState().nodes.find(n=>n.id===id)).filter(Boolean).map(n=>({id:n.id,name:n.title,asset:n.image,type:n.image?'image':n.type}));strip=attachmentStrip([...(session.uploads||[]),...refs],id=>{window.AgentUI.removeAttachment(nodeId,id);});element.prepend(strip);}}rich.setEditable(!!next&&!next.blocked);const stopping=!!next?.busy&&!next.text.trim();send.disabled=!next||next.blocked||(!stopping&&!next.text.trim());send.dataset.stopping=String(stopping);send.ariaLabel=stopping?'停止执行':'发送';send.innerHTML=window.UI_ICONS[stopping?'stop':'arrow']||'';send.onclick=run(()=>stopping?studioComposer.stop(nodeId):studioComposer.submit(nodeId));voice.disabled=attachment.disabled=!next||next.blocked;
    if(next)rich.sync(next.session);placeholder.sync();
    const key=next?[next.session.id,next.busy,next.session.selectedModelAtStart,!!next.session.messages.length].join(':'):'loading';
    if(key!==controlsKey){controlsKey=key;layout?.destroy();model?.destroy();confirmation?.destroy();
      confirmation=confirmControl({alignTo:()=>attachment,disabled:!next||next.blocked,onError,beforeOpen,compact:false});
      model=modelControl({session:next?.session,disabled:!next||next.blocked,onError,beforeOpen});
      left.replaceChildren(attachment,confirmation.element);right.replaceChildren(model.element,actions);layout=observeFooter(footer,confirmation);
    }
    onState?.(next);
  });
  return {element,input,get state(){return state;},open:run(()=>studioComposer.open(nodeId)),destroy(){disposed=true;rich.destroy();menu.destroy();unsubscribe();placeholder.destroy();layout?.destroy();model?.destroy();confirmation?.destroy();window.VoiceInput.cancel();}};
}
