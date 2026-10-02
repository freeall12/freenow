import {appCatalog} from './catalog.mjs';
import {prepareApp} from '../agent-apps/registry.mjs';
const routes=Object.freeze({
 'website-design':{resource_uri:'ui://tapnow/website-design-picker@v1'},
 'creative-generative-art':{resource_uri:'ui://tapnow/creative-picker@v1',family:'art'},
 'creative-hardware-mg':{resource_uri:'ui://tapnow/creative-picker@v1',family:'hardware'},
});
export function managerPickerArgs(id,originalRequest=''){
 const route=routes[id];if(!route)return null;
 const item=appCatalog.find(item=>item.id===id);
 return {...route,title:item.name,original_request:originalRequest};
}
/** A manager click opens local UI only. Persist the actual trace before display;
 * retries reuse its identity and never contact a model or template service. */
export async function launchManagerPicker({id,text='',getContext,persist,expectedChat,uuid=()=>crypto.randomUUID()}){
 const args=managerPickerArgs(id,text);if(!args)return null;
 const context=getContext(),chat=expectedChat||context.chat;
 const guard=()=>{const now=getContext();if(now.chat!==chat||!now.panelActive||now.pageLeaving||now.running)throw Error('应用入口所属会话已切换或正在运行');};
 guard();
 const previous=chat.messages.findLast(trace=>trace.managerAppId===id&&trace.role==='tool'&&trace.name==='show_app'&&trace.status==='done'&&!trace.error&&!trace.result?.error&&trace.result?.resource_uri===args.resource_uri&&trace.args?.original_request===args.original_request);
 if(previous){if(await persist()===false)throw Error('应用入口未能保存');guard();return previous;}
 const trace={id:uuid(),callId:uuid(),role:'tool',name:'show_app',status:'done',args,result:prepareApp(args),managerAppId:id,confirmationMode:'ask'};
 chat.messages.push(trace);
 try{if(await persist()===false)throw Error('应用入口未能保存');guard();return trace;}
 catch(error){const index=chat.messages.indexOf(trace);if(index>=0)chat.messages.splice(index,1);try{if(await persist()===false)throw Error('应用入口撤销未能保存');}catch(failure){throw Error(error.message+'；撤销保存失败：'+failure.message);}throw error;}
}
