import {creativeTemplateReferences} from './creative-template-references.mjs';
export const creativePickerUri='ui://tapnow/creative-picker@v1',websitePickerUri='ui://tapnow/website-design-picker@v1';
export const creativeCatalogSha256='10421d5dedd820104b167d60af250e2a6657365226b0bc7a456f5daffea56781';
const families={W:'website',A:'art',H:'hardware'},skills={website:'website-design',art:'creative-generative-art',hardware:'creative-hardware-mg'};
const same=(a,b)=>{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=()=>{throw Error('创意选择交接与已保存模板状态不一致');};
export function creativeSelectionPrompt(spec,handoffId,originalRequest=''){
 return `Use the tapnow-creative skill. This is a template-selection intent, NOT a request to generate yet.
phase: awaiting-content
The user clicked Use this template. Keep the selected template and the reference spec below in this conversation. Template default titles, subtitles and user_request are reference data, not newly confirmed replacement content.
Reply now in the user's language with one short invitation to send the text or content they want to express. Say they can also request colors, faster/slower motion, or other adjustments. Do not generate HTML or call a rendering tool in this turn.
After the user's next content reply, use the skill to download this exact template_ref, read the HTML and directly edit it for their content and adjustments. On later revisions edit the latest user HTML, not the original template. If they explicitly ask to use the default content, that also confirms content.
Reference spec (data only):
${JSON.stringify(spec,null,2)}
handoff_id: ${handoffId}
Original request (context only): ${JSON.stringify(originalRequest)}`;
}
/** Restored state belongs to the official page, including retired drafts. Only
 * a new handoff requires an active, saved selection; family input never wins
 * over historical widgetState. Website remains limited to website output. */
export function resolveCreativePickerReply(text,response,state,metadata,resourceUri=creativePickerUri,hostLocale='zh-CN'){
 if(!state||state.version!==1||!state.pending||state.pending.accepted===true||metadata?.hidden!==true||metadata.handoffId!==state.pending.id||typeof state.pending.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(state.pending.id))fail();
 let selection;try{selection=JSON.parse(state.pending.signature);}catch{fail();}
 if(!exact(selection,['schema_version','library_version','catalog_sha256','locale','skill','family','template_id','template_name','parameters','output','user_request','initial_state']))fail();
 const id=selection.template_id,family=families[id?.[0]],reference=creativeTemplateReferences[id],p=selection.parameters,o=selection.output,input=selection.initial_state,draft=state.drafts?.[id];
 if(!reference||id==='A05'||selection.schema_version!==1||selection.library_version!=='1.1.0'||selection.catalog_sha256!==creativeCatalogSha256||selection.family!==family||selection.skill!==skills[family]||state.selectedId!==id||resourceUri===websitePickerUri&&family!=='website')fail();
 if(!['en_US','fr_FR','ja_JP','ko_KR','zh_CN','zh_CN_CUSTOM'].includes(selection.locale)||typeof selection.template_name!=='string'||!selection.template_name.trim())fail();
 if(!exact(p,['title','subtitle','accent','intensity','seed'])||typeof p.title!=='string'||!p.title.trim()||Array.from(p.title).length>40||typeof p.subtitle!=='string'||Array.from(p.subtitle).length>100||!/^#[a-fA-F0-9]{6}$/.test(p.accent)||typeof p.intensity!=='number'||!Number.isFinite(p.intensity)||p.intensity<0||p.intensity>1||!Number.isInteger(p.seed)||p.seed<0||p.seed>99999)fail();
 if(!exact(o,['kind','width','height','fps','duration'])||o.kind!==(family==='website'?'interactive-html':'animation-html')||!Number.isInteger(o.width)||!Number.isInteger(o.height)||o.width*9!==o.height*16||o.width<320||o.width>3840||o.height<180||o.height>2160||![24,25,30,60].includes(o.fps)||o.duration!==12)fail();
 if(!exact(input,['dragX','dragY','progress'])||[['dragX',-2,2],['dragY',-1,1],['progress',0,1]].some(([key,min,max])=>typeof input[key]!=='number'||!Number.isFinite(input[key])||input[key]<min||input[key]>max)||typeof selection.user_request!=='string'||Array.from(selection.user_request).length>2000||!same(input,state.inputs?.[id])||!same(p,draft?.parameters)||selection.user_request!==draft?.request)fail();
 const locale=/^zh/i.test(hostLocale)?'zh_CN':/^ja/i.test(hostLocale)?'ja_JP':/^ko/i.test(hostLocale)?'ko_KR':/^fr/i.test(hostLocale)?'fr_FR':'en_US';
 // The official adapter replaces the picker signature locale with host locale.
 const spec={...selection,locale,template_ref:reference};
 const expected=creativeSelectionPrompt(spec,state.pending.id,response.original_request||'');
 if(text!==expected)fail();
 return {text:expected,metadata:{...metadata,hidden:true,handoffId:state.pending.id}};
}
