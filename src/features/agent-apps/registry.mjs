// Policies from official vendor-packages-CN3JnHbF Bue/wae; only integrated
// picker workflows are callable. Other archived templates do not imply support.
const picker = Object.freeze({allowExpanded:true,autoExpandOnReady:false,maxInlineHeight:520});
const definitions = [
 {resourceUri:'ui://tapnow/motion-picker@v1',title:'动效库',prefix:/^(T(0[1-9]|[12][0-9]|30)|G(0[1-9]|1[0-6]))$/,policy:picker},
 {resourceUri:'ui://tapnow/creative-picker@v1',title:'创意选择器',prefix:/^(W(0[1-9]|1[0-9]|2[01])|A(0[1-9]|1[0-7])|H0[1-8])$/,policy:picker},
 {resourceUri:'ui://tapnow/website-design-picker@v1',title:'网站设计选择器',prefix:/^W(0[1-9]|1[0-9]|2[01])$/,family:'website',policy:picker},
];
export function getApp(resourceUri){return definitions.find(item=>item.resourceUri===resourceUri)||null;}
export function appPolicy(resourceUri){const entry=getApp(resourceUri);if(!entry)throw Error('应用尚未接入或版本不受支持');return {...entry.policy,proxyUrl:new URL('./resources/mcp-app-proxy.html',import.meta.url).href};}
export function prepareApp(args){
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['resource_uri','title','original_request','recommended_template_id'].includes(k)))throw Error('应用展示参数无效');
 const entry=getApp(args.resource_uri);if(!entry)throw Error('应用尚未接入或版本不受支持');
 if(args.title!==undefined&&(typeof args.title!=='string'||!args.title.trim()||args.title.length>200))throw Error('应用标题无效');
 if(args.original_request!==undefined&&(typeof args.original_request!=='string'||args.original_request.length>12000))throw Error('应用原始需求过长或无效');
 if(args.recommended_template_id!==undefined&&(typeof args.recommended_template_id!=='string'||!entry.prefix.test(args.recommended_template_id)))throw Error('推荐模板标识无效');
 return {kind:'mcp_app',resource_uri:entry.resourceUri,request:{title:args.title||entry.title},response:{original_request:args.original_request||'',...(args.recommended_template_id?{recommended_template_id:args.recommended_template_id}:{}),...(entry.family?{family:entry.family}:{})}};
}
export function copyAppState(value){
 const text=JSON.stringify(value);if(!text||text.length>65536)throw Error('应用状态过大或无效');
 const result=JSON.parse(text);if(!result||typeof result!=='object'||Array.isArray(result))throw Error('应用状态无效');return result;
}
