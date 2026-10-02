'use strict';
function modelMap(value){
 if(!value)return {};
 const entries=typeof value==='string'?JSON.parse(value):value;
 if(!entries||typeof entries!=='object'||Array.isArray(entries))throw Error('AGENT_MODEL_MAP 必须是模型别名到服务端模型名称的 JSON 对象');
 for(const [alias,model]of Object.entries(entries))if(!/^[a-z0-9-]{1,100}$/.test(alias)||typeof model!=='string'||!model.trim()||model.length>200)throw Error('AGENT_MODEL_MAP 包含无效模型映射');
 return {...entries};
}
function resolveModel(selection,defaultModel,routes){
 if(selection!=null&&(typeof selection!=='object'||Array.isArray(selection)))throw Error('Agent 模型选择无效');
 const id=selection?.id??'auto';
 if(typeof id!=='string'||!/^[a-z0-9-]{1,100}$/.test(id))throw Error('Agent 模型选择无效');
 if(id==='auto')return defaultModel;
 if(Object.hasOwn(routes,id))return routes[id];
 const error=Error('所选 Agent 模型尚未连接，请在服务端 AGENT_MODEL_MAP 中配置对应模型。');error.code='configuration_required';throw error;
}
const thinkingSettings=import('../src/features/agent-composer/thinking-settings.mjs');
const efforts=new Set(['none','minimal','low','medium','high','xhigh','max']);
function reasoningMap(value){
 if(!value)return {};
 const entries=typeof value==='string'?JSON.parse(value):value;
 if(!entries||typeof entries!=='object'||Array.isArray(entries))throw Error('AGENT_REASONING_MAP 必须是模型别名到思考参数映射的 JSON 对象');
 const result={};
 for(const [alias,mapping]of Object.entries(entries)){
  if(!/^[a-z0-9-]{1,100}$/.test(alias)||!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw Error('AGENT_REASONING_MAP 包含无效模型映射');
  for(const [level,effort]of Object.entries(mapping))if(!['off','enabled','low','medium','high','xhigh','extra_high','max'].includes(level)||!efforts.has(effort))throw Error('AGENT_REASONING_MAP 包含无效思考档位');
  result[alias]={...mapping};
 }
 return result;
}
async function resolveReasoning(selection,routes){
 if(selection?.thinking===undefined)return undefined;
 const {validateThinking}=await thinkingSettings;
 const setting=validateThinking(selection.id,selection.thinking);
 const key=setting.enabled?setting.level||'enabled':'off';
 const mapping=Object.hasOwn(routes,selection.id)?routes[selection.id]:null;
 if(!mapping||!Object.hasOwn(mapping,key)){
  const error=Error('所选思考档位尚未连接，请在服务端 AGENT_REASONING_MAP 中配置对应参数。');error.code='configuration_required';throw error;
 }
 return {effort:mapping[key]};
}
module.exports={modelMap,resolveModel,reasoningMap,resolveReasoning};
