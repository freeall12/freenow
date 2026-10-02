import {prepareDirectorMarkup} from './director-markup.mjs';
import {preparePerformanceRhythm,performanceRhythmUri} from './performance-rhythm.mjs';
import {prepareStoryRoom,storyRoomUri} from './story-room.mjs';
import {prepareActorEmotion,actorEmotionUri} from './actor-emotion.mjs';
import {prepareProductionProgress,productionProgressUri,productionProgressPolicy} from './production-progress.mjs';
import {prepareInteractiveLearning,interactiveLearningUri,interactiveLearningImageDomains} from './interactive-learning.mjs';
import {prepareLibraryPicker,libraryPickerUri,libraryPickerPolicy,libraryPickerImageDomains} from './library-picker.mjs';
// Policies from official vendor-packages-CN3JnHbF Bue/wae. Other archived
// templates do not imply support.
const picker = Object.freeze({allowExpanded:true,autoExpandOnReady:false,maxInlineHeight:520});
const definitions = [
 {resourceUri:'ui://tapnow/motion-picker@v1',title:'动效库',prefix:/^(T(0[1-9]|[12][0-9]|30)|G(0[1-9]|1[0-6]))$/,policy:picker},
 {resourceUri:'ui://tapnow/creative-picker@v1',title:'创意选择器',prefix:/^(W(0[1-9]|1[0-9]|2[01])|A(0[1-9]|1[0-7])|H0[1-8])$/,policy:picker},
 {resourceUri:'ui://tapnow/website-design-picker@v1',title:'网站设计选择器',prefix:/^W(0[1-9]|1[0-9]|2[01])$/,family:'website',policy:picker},
 {resourceUri:'ui://tapnow/director-markup@v1',title:'导演画线批注',policy:Object.freeze({allowExpanded:false,autoExpandOnReady:false}),stateLimit:128*1024},
 {resourceUri:performanceRhythmUri,title:'表演节奏',policy:Object.freeze({allowExpanded:false,autoExpandOnReady:false})},
 {resourceUri:storyRoomUri,title:'剧本结构板',policy:Object.freeze({allowExpanded:false,autoExpandOnReady:false})},
 {resourceUri:actorEmotionUri,title:'人物情绪导演台',policy:Object.freeze({allowExpanded:true,autoExpandOnReady:false})},
 {resourceUri:productionProgressUri,title:'制作进度',policy:productionProgressPolicy},
 {resourceUri:interactiveLearningUri,title:'互动学习',policy:Object.freeze({allowExpanded:false,autoExpandOnReady:false}),csp:{imgDomains:interactiveLearningImageDomains}},
 {resourceUri:libraryPickerUri,title:'素材库',policy:libraryPickerPolicy,csp:{imgDomains:libraryPickerImageDomains}},
];
export function getApp(resourceUri){return definitions.find(item=>item.resourceUri===resourceUri)||null;}
export function appPolicy(resourceUri){const entry=getApp(resourceUri);if(!entry)throw Error('应用尚未接入或版本不受支持');return {...entry.policy,proxyUrl:new URL(entry.resourceUri===productionProgressUri?'./resources/production-progress-proxy.html':'./resources/mcp-app-proxy.html',import.meta.url).href};}
export function prepareApp(args){
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['resource_uri','title','original_request','recommended_template_id','data'].includes(k)))throw Error('应用展示参数无效');
 const entry=getApp(args.resource_uri);if(!entry)throw Error('应用尚未接入或版本不受支持');
 if(args.title!==undefined&&(typeof args.title!=='string'||!args.title.trim()||args.title.length>200))throw Error('应用标题无效');
 if(entry.resourceUri==='ui://tapnow/director-markup@v1'){
  if(args.original_request!==undefined||args.recommended_template_id!==undefined)throw Error('导演批注不使用模板选择参数');
  return {kind:'mcp_app',resource_uri:entry.resourceUri,request:{title:args.title||entry.title},response:prepareDirectorMarkup(args.data,args.title||entry.title)};
 }
 if([performanceRhythmUri,storyRoomUri,actorEmotionUri,productionProgressUri,interactiveLearningUri,libraryPickerUri].includes(entry.resourceUri)){
  if(args.original_request!==undefined||args.recommended_template_id!==undefined)throw Error('工作流应用不使用模板选择参数');
  const prepare=new Map([[performanceRhythmUri,preparePerformanceRhythm],[storyRoomUri,prepareStoryRoom],[actorEmotionUri,prepareActorEmotion],[productionProgressUri,prepareProductionProgress],[interactiveLearningUri,prepareInteractiveLearning],[libraryPickerUri,prepareLibraryPicker]]).get(entry.resourceUri);
  return {kind:'mcp_app',resource_uri:entry.resourceUri,request:{title:args.title||entry.title},response:prepare(args.data,args.title||entry.title)};
 }
 if(args.data!==undefined)throw Error('模板选择器不接受批注正文');
 if(args.original_request!==undefined&&(typeof args.original_request!=='string'||args.original_request.length>12000))throw Error('应用原始需求过长或无效');
 if(args.recommended_template_id!==undefined&&(typeof args.recommended_template_id!=='string'||!entry.prefix.test(args.recommended_template_id)))throw Error('推荐模板标识无效');
 return {kind:'mcp_app',resource_uri:entry.resourceUri,request:{title:args.title||entry.title},response:{original_request:args.original_request||'',...(args.recommended_template_id?{recommended_template_id:args.recommended_template_id}:{}),...(entry.family?{family:entry.family}:{})}};
}
export function copyAppState(value,limit=65536){
 const text=JSON.stringify(value);if(!text||new TextEncoder().encode(text).length>limit)throw Error('应用状态过大或无效');
 const result=JSON.parse(text);if(!result||typeof result!=='object'||Array.isArray(result))throw Error('应用状态无效');return result;
}
