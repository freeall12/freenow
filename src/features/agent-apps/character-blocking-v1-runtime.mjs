import {characterBlockingV1Uri,prepareCharacterBlockingV1,validateCharacterBlockingV1State,resolveCharacterBlockingV1Reply} from './character-blocking-v1.mjs';
const clone=value=>structuredClone(value),fail=message=>{throw Error(message);};
function abort(signal){if(signal?.aborted)throw signal.reason||new DOMException('历史人物站位已取消','AbortError');}

/** V1 accepts real textual board input only. No asset read, portrait crop, model
 * call or media request is part of its shipped protocol. */
export function createCharacterBlockingV1Runtime({getProjectId}={}){
 if(typeof getProjectId!=='function')throw TypeError('getProjectId adapter is required');
 const preparations=new WeakMap();
 async function prepareAppArgs(args,{isCurrent=()=>true,signal}={}){
  if(args.resource_uri!==characterBlockingV1Uri)return args;abort(signal);
  if(!isCurrent())fail('历史人物站位所属会话已切换');
  const projectId=getProjectId(),prepared=clone(args),response=prepareCharacterBlockingV1(prepared.data,prepared.title);
  abort(signal);if(!isCurrent()||projectId!==getProjectId())fail('历史人物站位所属画布或会话已切换');
  preparations.set(prepared,{version:1,resource_uri:characterBlockingV1Uri,projectId,responseFingerprint:JSON.stringify(response)});return prepared;
 }
 function bindPreparedResult(result,args){
  if(args.resource_uri!==characterBlockingV1Uri)return result;
  const binding=preparations.get(args);
  if(!binding||binding.projectId!==getProjectId()||result.resource_uri!==characterBlockingV1Uri||JSON.stringify(result.response)!==binding.responseFingerprint)fail('历史人物站位缺少真实本地输入绑定');
  return {...result,characterBlockingV1SourceContext:clone(binding)};
 }
 function capture(data,{trace,chat,isCurrent}={}){
  const binding=trace?.result?.characterBlockingV1SourceContext;
  if(typeof isCurrent!=='function'||!trace?.id||!chat?.id||trace.args?.resource_uri!==characterBlockingV1Uri||trace.result?.resource_uri!==characterBlockingV1Uri||binding?.version!==1||binding.resource_uri!==characterBlockingV1Uri||binding.projectId!==getProjectId()||JSON.stringify(data)!==binding.responseFingerprint)fail('历史人物站位缺少当前会话真实来源');
  // Revalidate the actual V1 board when restoring a persisted host binding.
  initialValidation(data);const scope={projectId:getProjectId(),traceId:trace.id,chatId:chat.id},fingerprint=JSON.stringify(binding),lifetime=new AbortController();
  function current(){
   abort(lifetime.signal);
   if(!isCurrent()||getProjectId()!==scope.projectId||trace.id!==scope.traceId||chat.id!==scope.chatId||trace.args?.resource_uri!==characterBlockingV1Uri||trace.result?.resource_uri!==characterBlockingV1Uri||trace.result.response!==data||trace.result.characterBlockingV1SourceContext!==binding||JSON.stringify(binding)!==fingerprint||JSON.stringify(data)!==binding.responseFingerprint)fail('历史人物站位卡片、画布或输入来源已变化');return true;
  }
  async function guard(signal){abort(signal);return current();}
  async function reply(message,state){
   const saved=trace.appState;
   if(!saved||state!==saved)fail('历史人物站位交接只能读取该 trace 实际保存的状态');
   const snapshot=clone(validateCharacterBlockingV1State(saved,data)),stateFingerprint=JSON.stringify(saved);
   const guardState=()=>{current();if(trace.appState!==saved||JSON.stringify(saved)!==stateFingerprint)fail('历史人物站位实际保存状态在交接期间已变化');};
   guardState();await guard();guardState();
   const receipt=await resolveCharacterBlockingV1Reply(message,data,snapshot);guardState();return receipt;
  }
  current();return {scope,binding,guard,reply,validateState:value=>{current();return validateCharacterBlockingV1State(value,data);},isCurrent:()=>{try{return current();}catch{return false;}},dispose:()=>lifetime.abort(new DOMException('历史人物站位页面已关闭','AbortError'))};
 }
 return {prepareAppArgs,bindPreparedResult,capture};
}
function initialValidation(data){
 const {version,summary,title,...input}=data;
 if(version!==1||typeof summary!=='string'||summary.length>200)fail('历史人物站位版本或摘要无效');
 const expected=prepareCharacterBlockingV1(input,title);
 if(JSON.stringify(expected)!==JSON.stringify({...data,summary:title}))fail('历史人物站位数据未经过规范输入');
}
