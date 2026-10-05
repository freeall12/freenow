import {appendRecoveryActions} from './recovery-actions.mjs';
import {createDraftFinalCard} from './draft-final-card.mjs';
import {isDraftFinal} from './draft-final.mjs';
import {createGenerationPromptEditor} from '../../../assets/agent-editor.js';
import {generationPromptPreviews} from './prompt-preview.mjs';
import {renderGenerationPrompt,generationMentionData} from './prompt.mjs';
import {audioTypeIcon} from './audio-assets.mjs';
import {audioModels,audioLabels,sceneNames,audioSpec,audioModel,audioCompatibility,normalizeAudio,audioSourceVideoState} from './audio.mjs';
import {icons} from './icons.mjs';
import {referenceIcons} from '../agent-composer/reference-icons.mjs';
import {imageModels,videoModels,findModel,createGenerationDraft,normalizeDraft,selectGenerationModel,parameterOptions,referenceShape,referencesFor,compatibility,confirmedArguments,generationStatus,generationResultMode} from './model.mjs';
import {isBatch,batchDraft,batchCompatibility,batchOptions,changeBatch,batchDecisions,sharedReferences} from './batch.mjs';
import {openParameterMenu} from './menu.mjs';
export {supportsCard,confirmedArguments,createGenerationDraft} from './model.mjs';
const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const glyph=key=>{const n=el('span','generation-glyph');n.innerHTML=key==='audioType'?audioTypeIcon:icons[key]||referenceIcons[key]||'';return n;};
const labels={...audioLabels,model:'模型',videoMode:'生成方式',aspect:'比例',imageSize:'尺寸',quality:'质量',count:'数量',duration:'时长',resolution:'分辨率',generateAudio:'声音'};
const modeNames={TEXT_TO_VIDEO:'文生视频',IMAGE_TO_VIDEO:'图生视频',START_END_TO_VIDEO:'首尾帧',REFERENCE_TO_VIDEO:'全能参考',REFERENCE_VIDEO_TO_VIDEO:'视频参考',VIDEO_EDIT:'视频编辑'};
const valueLabel=(key,v)=>key==='audioScene'?sceneNames[v]:key==='lyricsMode'?({auto:'自动',custom:'自定义',instrumental:'纯音乐'})[v]:['speechRate','loudnessRate'].includes(key)?Math.round((1+v/100)*100)/100+'×':key==='sampleRate'?v+' Hz':key==='audioFormat'?String(v).toUpperCase().replace('_',' '):typeof v==='boolean'?v?'开启':'关闭':key==='count'?v+'×':key==='duration'?v===-1||v===null?'自动':typeof v==='number'?v+'s':String(v):key==='generateAudio'?v?'开启':'关闭':key==='videoMode'?modeNames[v]||v:/^(auto|adaptive)$/i.test(String(v))?'自适应':String(v);

export function createGenerationCard(initial,{getNodes=()=>[],getEdges=()=>[],getConfig=()=>({}),getAudioConfiguration=()=>window.GenerationAPI?.configuration?.(),listVoices=options=>window.AudioAPI?.listVoices(options)||Promise.resolve({voices:[],configured:false}),previewVoice=(voice,options)=>window.AudioAPI?.previewVoice(voice,options),getMode=()=> 'ask',setMode=()=>{},onConfirm,onChange=()=>{},onOpenNode=()=>{},resolveAsset=async url=>url}={}){
 if(isDraftFinal(initial.args))return createDraftFinalCard(initial,{getNodes,getEdges,getMode,setMode,onConfirm,onChange,onOpenNode,resolveAsset});
 let trace=initial,draft=trace.confirmationDraft||createGenerationDraft(trace.args,getConfig(trace.args.nodeId),getNodes()),items=isBatch(trace)?batchDraft(trace,getConfig,getNodes()):null;
 let voiceState=null,menu=null,signature=stamp(initial),focusState=null,formError='';
 let audioMetadata=null,audioMetadataError='',audioMetadataScope='',audioMetadataPending=false,audioMetadataRevision=0,disposed=false;
 const modes=new Map(),inputs=new Map(),root=el('section','agent-generation-card');
 root.setAttribute('aria-label',(items?'批量':'')+(trace.args.kind==='image.generate'?'图片生成确认':trace.args.kind==='audio.generate'?'音频生成确认':'视频生成确认'));
 root.dataset.batch=String(!!items);
 const previews=generationPromptPreviews(root,{resolve:generationMentionData,resolveAsset});
 function stamp(value){return JSON.stringify([value.status,value.generationJob,value.result,value.confirmationMode,value.batchItems?.map(item=>[item.status,item.result,item.generationJob])]);}
 const button=(text,action,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=action;return b;};
 const persist=()=>{trace.confirmationDraft=structuredClone(draft);if(items)trace.batchDraft=structuredClone(items);onChange(trace);};
 function closeMenu(){menu?.close();menu=null;}
 function applyResultMode(mode){
  if(trace.status!=='pending'||draft.kind!=='image.generate')return false;
  captureInputs();const nodes=getNodes();draft=normalizeDraft({...draft,resultMode:mode},nodes);
  if(items)for(const item of items)item.args=normalizeDraft({...item.args,resultMode:mode},nodes);
  return true;
 }
 function updateResultMode(event){
  const mode=event?.detail?.mode;if(!['pile','spread','variants'].includes(mode))return;
  if(applyResultMode(mode)){formError='';persist();render();}
 }
 function resultModeStorage(event){if(event.key==='tapnow.canvas.generation-result-mode'||event.key===null)updateResultMode({detail:{mode:generationResultMode()}});}
 function change(key,value){captureInputs();formError='';draft=items?changeBatch(draft,items,key,value,getNodes()):key==='model'?selectGenerationModel(draft,value,getNodes()):normalizeDraft({...draft,[key]:value},getNodes());if(key==='duration'&&draft.kind==='audio.generate'){draft.audioDurationExplicit=true;draft.audioDurationEdited=true;}persist();render();}
 function refreshAudioMetadata(){
  const state=audioSourceVideoState(null,draft,getNodes());if(!state.candidate){if(audioMetadataScope){audioMetadataScope='';audioMetadata=null;audioMetadataError='';audioMetadataPending=false;audioMetadataRevision++;}return;}
  const scope=JSON.stringify([draft.model,draft.audioScene,draft.nodeId,draft.referenceIds]);if(scope===audioMetadataScope)return;
  audioMetadataScope=scope;audioMetadata=null;audioMetadataError='';audioMetadataPending=true;const revision=++audioMetadataRevision;
  Promise.resolve().then(getAudioConfiguration).then(metadata=>{if(disposed||revision!==audioMetadataRevision)return;audioMetadata=metadata;if(!metadata)audioMetadataError='无法确认视频拟音供应商，请检查生成服务后重新打开确认卡';}).catch(()=>{if(!disposed&&revision===audioMetadataRevision)audioMetadataError='无法确认视频拟音供应商，请检查生成服务后重新打开确认卡';}).finally(()=>{
   if(disposed||revision!==audioMetadataRevision)return;
   const entry=[...inputs].find(([,input])=>input.dom.contains(document.activeElement)),focus=entry?{index:entry[0],range:entry[1].capture()}:null;
   audioMetadataPending=false;captureInputs();render();
   if(focus)queueMicrotask(()=>{const input=inputs.get(focus.index);if(!disposed&&input?.dom.isConnected)input.restore(focus.range);});
  });
 }
 function captureInputs(){for(const [index,input]of inputs)(items?items[index].args:draft).prompt=input.getText();}
 function destroyInputs(){for(const input of inputs.values())input.destroy();inputs.clear();}
 function confirm(allowed){
  try{
   captureInputs();
   const sourceVideo=audioSourceVideoState(audioMetadata,draft,getNodes());
   if(allowed&&sourceVideo.candidate&&(audioMetadataPending||sourceVideo.pending||audioMetadataError||sourceVideo.reason))throw Error(audioMetadataError||sourceVideo.reason||'视频拟音供应商待确认');
   const args=allowed?(items?{decisions:batchDecisions(trace,draft,items,getNodes(),{audioMetadata})}:confirmedArguments(trace.args,draft,getNodes(),getEdges(),{audioMetadata})):undefined;
   persist();closeMenu();root.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=true);for(const input of inputs.values())input.setEditable(false);onConfirm(trace,allowed,args);
  }catch(error){formError=error.message;render();}
 }
 function references(args){
  const nodes=referencesFor(args,getNodes());if(!nodes.length)return null;
  const group=el('div','generation-references');group.title='参考素材';
  for(const [index,node]of nodes.slice(0,3).entries()){
   const b=button('',()=>Promise.resolve(onOpenNode(node.id)).catch(error=>{formError=error.message;render();}),'generation-thumb');b.setAttribute('aria-label','查看参考：'+node.title);
   if(node.image){const img=el('img','');img.alt='';b.append(img);Promise.resolve(resolveAsset(node.image)).then(url=>{img.src=url;}).catch(()=>{});}else b.append(glyph(node.type==='video'?'videoType':node.type==='text'?'textType':'folderType'));
   if(index===2&&nodes.length>3)b.append(el('span','generation-reference-overflow','+'+(nodes.length-3)));group.append(b);
  }
  return group;
 }
 function promptItem(value,index,perItemRefs){
  const item=el('div','generation-prompt-item'),mode=modes.get(index)||'collapsed',editable=trace.status==='pending'&&!value.rejected,args=value.args;
  item.dataset.index=String(index);item.dataset.rejected=String(!!value.rejected);
  if(mode==='editing'&&editable){
   const editor=el('div','generation-prompt-editor'),host=el('div','generation-prompt-editor-host');editor.append(host);
   const input=createGenerationPromptEditor({element:host,value:args.prompt||'',args,getNodes,label:items?`第 ${index+1} 项生成提示词`:'生成提示词',onChange:value=>{args.prompt=value;persist();},onOpenNode,resolveAsset,onError:error=>{formError=error.message;render();}});input.dom.dataset.executionControl=(trace.id||'generation')+':prompt:'+index;inputs.set(index,input);
   const footer=el('div','generation-prompt-actions');footer.append(button('完成',()=>{args.prompt=input.getText();persist();modes.set(index,'expanded');render();},'generation-small-button'));editor.append(footer);item.append(editor);return item;
  }
  const line=el('div','generation-prompt-line'),body=el('div','generation-prompt-body');
  if(items)line.append(el('span','generation-prompt-index',(index+1)+'.'));
  const text=el('div','generation-prompt-text');text.append(renderGenerationPrompt(args.prompt||'未提供提示词',args,getNodes(),{onOpenNode,resolveAsset,onError:error=>{formError=error.message;render();}}));text.dataset.mode=mode;
  text.setAttribute('role','button');text.tabIndex=0;text.setAttribute('aria-expanded',String(mode==='expanded'));text.setAttribute('aria-label',items?`展开或收起第 ${index+1} 项提示词`:'展开或收起生成提示词');
  const toggle=()=>{if(trace.status!=='pending'&&mode==='collapsed'&&text.dataset.overflow!=='true')return;modes.set(index,mode==='collapsed'?'expanded':'collapsed');render();};text.onclick=toggle;text.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();toggle();}};body.append(text);line.append(body);
  if(mode==='collapsed'){const expand=button('',toggle,'generation-expand');expand.setAttribute('aria-label',items?`展开第 ${index+1} 项提示词`:'展开提示词');expand.append(glyph('expand'));line.append(expand);}
  else if(editable){const footer=el('div','generation-prompt-actions');const edit=button('编辑',()=>{modes.set(index,'editing');render();queueMicrotask(()=>inputs.get(index)?.focus({preventScroll:true}));},'generation-small-button');if(items)edit.setAttribute('aria-label',`编辑第 ${index+1} 项提示词`);footer.append(edit);body.append(footer);}
  if(perItemRefs){const refs=references(args);const row=el('div','generation-item-references');row.append(refs||el('span','generation-no-reference','无参考素材'));body.append(row);}
  if(items&&trace.status==='pending'){
   const reject=button(value.rejected?'恢复':'移除',()=>{captureInputs();value.rejected=!value.rejected;formError='';persist();render();},'generation-item-reject');reject.setAttribute('aria-label',(value.rejected?'恢复':'移除')+`第 ${index+1} 项`);line.append(reject);
  }
  item.append(line);queueMicrotask(()=>{if(text.isConnected){const overflow=text.scrollHeight>text.clientHeight+1;text.dataset.overflow=String(overflow);if(!editable&&!overflow)line.querySelector('.generation-expand')?.remove();}});return item;
 }
 function prompt(){
  const wrap=el('div','generation-prompt'),list=el('div','generation-prompt-list');wrap.append(list);
  const perItemRefs=items&&sharedReferences(items)===null;
  (items||[{args:draft}]).forEach((item,index)=>list.append(promptItem(item,index,perItemRefs)));
  return wrap;
 }
 function chip(key,value,options,{icon,model=false,disabled=false,prefix=false}={}){
  const editable=trace.status==='pending'&&!disabled&&options?.length>0&&(key!=='videoMode'||options.length>1);
  const current=options?.find(o=>o.value===value),b=el(editable?'button':'span','generation-chip');if(editable)b.type='button';
  if(icon)b.append(glyph(icon));if(current?.icon){const img=el('img','');img.src=current.icon;img.alt='';b.append(img);}
  if(prefix)b.append(el('span','generation-param-prefix',labels[key]));
  const valueText=el('span','',current?.label||valueLabel(key,value));b.append(valueText);b.title=labels[key];
  if(editable){
   b.setAttribute('aria-label',labels[key]+': '+(current?.label||valueLabel(key,value)));b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');
   const numericSpec=draft.kind==='audio.generate'&&key==='duration'?audioSpec(draft)?.duration:null;
   const duration=!!numericSpec||key==='duration'&&draft.model==='seedance-2.5'&&options.every(o=>o.value>=0);if(!duration)b.append(glyph('chevron'));
   b.onclick=()=>{if(menu){closeMenu();return;}menu=openParameterMenu(b,{label:labels[key],options,value,model,duration,numericSpec,onSelect:nextValue=>{value=nextValue;
    if(duration){draft=items?changeBatch(draft,items,key,value,getNodes()):normalizeDraft({...draft,[key]:value},getNodes());if(draft.kind==='audio.generate'){draft.audioDurationExplicit=true;draft.audioDurationEdited=true;}persist();valueText.textContent=valueLabel(key,value);b.setAttribute('aria-label',labels[key]+': '+valueLabel(key,value));}
    else change(key,value);
   },onClose:()=>{menu=null;}});};
  }
  return b;
 }
 function render(){
  refreshAudioMetadata();
  closeMenu();previews.hide();destroyInputs();root.replaceChildren();const status=generationStatus(trace),kind=draft.kind==='image.generate'?'image':draft.kind==='audio.generate'?'audio':'video';root.dataset.status=status.state;
  const header=el('header','generation-card-header');header.append(glyph(kind+'Type'),el('span','',kind==='image'?'图片生成':kind==='audio'?'音频生成':'视频生成'));
  if(status.label)header.append(el('span','generation-card-status',status.label));root.append(header,prompt());
  const parameters=el('div','generation-card-parameters'),chips=el('div','generation-chip-list'),model=findModel(draft.kind,draft.model),nodes=getNodes();
  if(model?.nativePanorama)parameters.append(el('p','generation-card-native-note','Hunyuan 独立替代 · 图生360全景 · 单参考 / 单结果 · 固定2:1 · 原生尺寸'));
  const reason=m=>{const candidate=m.nativePanorama&&m.id!==draft.model?selectGenerationModel(draft,m.id,nodes):draft;return items?batchCompatibility({...candidate,model:m.id},items,nodes):compatibility(draft.kind,m,referenceShape(draft,nodes),candidate);};
  const modelOptions=(kind==='image'?imageModels:kind==='audio'?audioModels:videoModels).map(m=>({value:m.id,label:m.name,icon:m.icon,disabled:!!reason(m),reason:reason(m)}));
  if(items)chips.append(el('span','generation-chip',`${items.length} 个任务`),el('span','generation-divider'));
  chips.append(chip('model',model?.id||draft.model,model?modelOptions:[],{model:true}));
  const options=items?batchOptions(draft,items,nodes):parameterOptions(draft,nodes);
  if(kind==='audio'){
   const shape=referenceShape(draft,nodes),s=audioSpec(draft),sourceVideo=audioSourceVideoState(audioMetadata,draft,nodes);
   const order=['audioScene','duration','lyricsMode','stability','promptInfluence','sampleRate','speechRate','pitchRate','loudnessRate','audioFormat','subtitle','loop'];
   for(const key of order){
    if(draft[key]===undefined||key==='audioScene'&&Object.keys(model?.scenes||{}).length<2)continue;
    let choices=options[key]?.map(value=>({value,label:valueLabel(key,value)}));
    if(key==='audioScene')choices=['Music','Sound','Text-to-Speech'].map(value=>({value,label:sceneNames[value],disabled:!model?.scenes[value],reason:'所选模型不支持此场景'}));
    const value=key==='duration'&&sourceVideo.candidate?(audioMetadataPending||sourceVideo.pending?'待确认':sourceVideo.active?'跟随视频'+(trace.args.duration!==undefined||draft.audioDurationExplicit?'（要求 '+draft.duration+'s）':''):shape.video?'自适应':draft[key]):key==='duration'&&shape.video?'自适应':draft[key];
    chips.append(el('span','generation-divider'),chip(key,value,choices,{disabled:key==='duration'&&!!shape.video,prefix:['stability','promptInfluence','sampleRate','speechRate','pitchRate','loudnessRate','subtitle','loop'].includes(key),icon:key==='audioScene'||key==='lyricsMode'?'method':key==='duration'?'duration':undefined}));
   }
   if(s?.voice){const voice=button(voiceState?.voices?.find(v=>v.id===draft.voice)?.name||draft.voice||'音色',e=>{
    const trigger=e.currentTarget;if(menu){closeMenu();return;}if(!window.AudioAPI?.openVoiceMenu){formError='音色菜单尚未加载，请稍后重试';render();return;}
    const currentModel=draft.model,currentTrace=trace;
    menu=window.AudioAPI.openVoiceMenu(trigger,{model:'eleven_v3',value:draft.voice,listVoices:async options=>{const state=await listVoices(options);if(trigger.isConnected&&trace===currentTrace&&draft.model===currentModel)voiceState=state;return state;},previewVoice,isCurrent:()=>trace.status==='pending'&&trace===currentTrace&&draft.model===currentModel&&trigger.isConnected,onSelect:value=>change('voice',value),onClose:()=>menu=null});
   },'generation-chip');voice.setAttribute('aria-label','音色');voice.setAttribute('aria-haspopup','dialog');voice.disabled=trace.status!=='pending';chips.append(el('span','generation-divider'),voice);}
  }
  for(const key of ['videoMode','aspect','imageSize','quality','duration','resolution','generateAudio','count']){
   if(kind==='audio'||draft[key]===undefined)continue;
   chips.append(el('span','generation-divider'),chip(key,draft[key],options[key]?.map(v=>({value:v,label:valueLabel(key,key==='count'&&kind==='image'&&model?.midjourney?v*4:v)})),{icon:({videoMode:'method',generateAudio:'audio',aspect:'aspect',imageSize:'size',quality:'quality',duration:'duration',resolution:'size',count:'count'})[key]}));
  }
  parameters.append(chips);const shared=items?sharedReferences(items):undefined,refs=items?(shared?references({...draft,referenceIds:shared}):null):references(draft);if(refs)parameters.append(refs);root.append(parameters);
  const sourceVideo=audioSourceVideoState(audioMetadata,draft,nodes);if(sourceVideo.candidate){const text=audioMetadataError||sourceVideo.reason||(audioMetadataPending||sourceVideo.pending?'视频拟音供应商待确认':sourceVideo.hint);if(text)root.append(el('p','generation-native-audio-note',text));}
  if(kind==='audio')for(const [index,item]of (items?items.filter(item=>!item.rejected):[{args:draft}]).entries()){
   const args=item.args;if(audioModel(args.model)?.scenes[args.audioScene]!=='sonilo-music')continue;
   const note=el('div','generation-native-audio-note'),video=referenceShape(args,nodes).video;
   const explicitDuration=args.audioDurationExplicit===true||!items&&trace.args.duration!==undefined,durationNote=video?(explicitDuration?'明确指定 '+args.duration+' 秒；提交前须与源视频实测时长一致':'跟随完整视频，生成前读取真实时长'):args.duration+' 秒';
   note.append(el('p','',(items?'第 '+(index+1)+' 个任务：':'')+'Sonilo 音乐请求 '+(args.count??1)+' 个 WAV 变体；原生接口按每个变体计费。时长：'+durationNote+'。提交前核对当前供应商配置与原生限制。'));
   if(args.segments!==undefined){const detail=el('details','generation-native-audio-segments');detail.open=true;detail.append(el('summary','','音乐分段 · '+args.segments.length+' 段（可展开核对完整指令）'));for(const segment of args.segments){const line=el('p','',segment.start+' 秒 · '+(segment.label??'未指定标签')+'\n'+segment.prompt);line.style.whiteSpace='pre-wrap';line.style.overflowWrap='anywhere';detail.append(line);}note.append(detail);}root.append(note);
  }
  if(kind==='audio'&&draft.lyricsMode==='custom'){const lyrics=el(trace.status==='pending'?'textarea':'div','generation-lyrics');lyrics.setAttribute('aria-label','lyrics-editor');if(trace.status==='pending'){lyrics.rows=4;lyrics.maxLength=12000;lyrics.value=draft.lyrics||'';lyrics.placeholder='在此输入或粘贴歌词…';lyrics.oninput=()=>{draft.lyrics=lyrics.value;persist();};}else lyrics.textContent=draft.lyrics;root.append(lyrics);}
  if(trace.status==='pending'){
   const footer=el('footer','generation-confirm-footer'),auto=el('label','generation-auto'),toggle=button('',()=>{try{setMode(getMode()==='auto'?'ask':'auto');updateMode();}catch(error){formError=error.message;render();}},'generation-auto-switch');toggle.role='switch';toggle.setAttribute('aria-label','自动生成');toggle.setAttribute('aria-checked',String(getMode()==='auto'));toggle.append(el('span',''));auto.append(toggle,el('span','','Act'));footer.append(auto,el('span','generation-spacer'));
   const allRejected=items?.every(item=>item.rejected),issue=sourceVideo.candidate&&(audioMetadataPending||sourceVideo.pending||audioMetadataError||sourceVideo.reason)?audioMetadataError||sourceVideo.reason||'视频拟音供应商待确认':items&&!allRejected?batchCompatibility(draft,items,nodes):kind==='audio'?audioCompatibility(draft,referenceShape(draft,nodes)):'';
   if(!allRejected)footer.append(button('取消',()=>confirm(false),'generation-small-button'));
   const submit=button(allRejected?'全部拒绝':'确认',()=>confirm(!allRejected),'generation-confirm-button');submit.disabled=!!issue;if(issue)submit.title=issue;footer.append(submit);root.append(footer);
   if(issue)root.append(el('p','generation-error',issue));
  }
  appendRecoveryActions(root,trace,{onError:error=>{formError=error.message;render();}});
  const error=formError||status.error;if(error){const message=el('p','generation-error',error);message.role='alert';root.append(message);}
 }
 const updateMode=()=>root.querySelector('[role=switch]')?.setAttribute('aria-checked',String(getMode()==='auto'));
 window.addEventListener('agent:confirmation-mode',updateMode);
 window.addEventListener('canvas:generation-result-mode',updateResultMode);
 window.addEventListener('storage',resultModeStorage);
 applyResultMode(generationResultMode());
 render();
 return {
  element:root,
  suspend(){closeMenu();const entry=[...inputs].find(([,input])=>input.dom.contains(document.activeElement));focusState=entry?{index:entry[0],range:entry[1].capture()}:null;},
  destroy(){disposed=true;audioMetadataRevision++;closeMenu();previews.destroy();destroyInputs();window.removeEventListener('agent:confirmation-mode',updateMode);window.removeEventListener('canvas:generation-result-mode',updateResultMode);window.removeEventListener('storage',resultModeStorage);root.remove();},
  update(next){
   trace=next;const nextStamp=stamp(trace);
   if(signature!==nextStamp){signature=nextStamp;if(trace.status!=='pending'){
    draft=trace.confirmationDraft||createGenerationDraft(trace.args,getConfig(trace.args.nodeId),getNodes());
    if(items)items=batchDraft(trace,getConfig,getNodes());
    for(const [index,mode]of modes)if(mode==='editing')modes.set(index,'expanded');
   }render();}
   if(focusState){const saved=focusState;focusState=null;queueMicrotask(()=>{const input=inputs.get(saved.index);if(input?.dom.isConnected)input.restore(saved.range);});}
   updateMode();
  }
 };
}
