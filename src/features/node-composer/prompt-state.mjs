import {subjectSegments} from '../subject-library/model.mjs';
import {assetSegments,assetReference,projectAssets} from './library-mentions.mjs';
import {splitPrompt} from '../focus-edit/model.mjs';
const tokenPattern = /\{\{(Image|Video|Audio|Text) (\d+)\}\}/g;
export function mentionItems(items) {
  const counts = {};
  return items.filter(item => !item.empty).map(item => ({...item, renderText: `${item.type[0].toUpperCase()+item.type.slice(1)} ${counts[item.type]=(counts[item.type]||0)+1}`}));
}
// Store source identity separately from the provider-facing ordinal tokens.
export function reconcilePrompt(config, items) {
  const next = mentionItems(items), byKey = new Map(next.map(item=>[item.key,item.renderText]));
  const before = new Map((config.promptReferenceBindings || []).map(item=>[item.renderText,item.referenceKey]));
  const prompt = assetSegments(config.prompt || '').map(part=>typeof part==='string'?part.replace(tokenPattern, (token,kind,index) => {
    const name = `${kind} ${index}`;
    if (!before.has(name)) return token;
    const current = byKey.get(before.get(name));
    return current ? `{{${current}}}` : '';
  }):part.token).join('');
  return {...config,prompt,promptReferenceBindings:next.map(item=>({renderText:item.renderText,referenceKey:item.key}))};
}
export function documentText(doc) {
  const inline = node => node.type === 'text' ? node.text || '' : node.type === 'hardBreak' ? '\n' : node.type === 'promptMention' ? node.attrs.token : (node.content || []).map(inline).join('');
  return (doc.content || []).map(inline).join('\n');
}
export function promptDocument(value, items = []) {
  const available = new Map(mentionItems(items).map(item=>[item.renderText,item]));
  const content = [], text = value => {if(value)content.push({type:'text',text:value});};
  for (const segment of assetSegments(value)) {
    if(typeof segment!=='string'){const item=assetReference(segment.asset);content.push({type:'promptMention',attrs:{token:segment.token,key:item.key,type:item.type,label:item.title,thumbnail:item.thumbnail||'',url:item.url||''}});continue;}
    for (const subject of subjectSegments(segment)) {
    if(typeof subject!=='string'){content.push({type:'promptMention',attrs:{token:subject.token,key:'subject:'+subject.id,type:'subject',label:subject.name,thumbnail:'',url:''}});continue;}
    for (const part of splitPrompt(subject)) {
    if (typeof part !== 'string') {content.push({type:'promptMention',attrs:{token:part.token,type:'magic',label:part.mark.isLoading?'识别中…':part.mark.label_name,key:part.mark._markId}});continue;}
    let end=0;
    for(const match of part.matchAll(tokenPattern)) {
      text(part.slice(end,match.index));const renderText=match[1]+' '+match[2],item=available.get(renderText);
      if(item)content.push({type:'promptMention',attrs:{token:match[0],key:item.key,type:item.type,label:item.title||renderText,thumbnail:item.thumbnail||'',url:item.url||''}});
      else text(match[0]);end=match.index+match[0].length;
    }
    text(part.slice(end));
    }
    }
  }
  const paragraphs=[{type:'paragraph',content:[]}];
  for(const node of content) {
    if(node.type!=='text'){paragraphs.at(-1).content.push(node);continue;}
    node.text.split('\n').forEach((line,i)=>{if(i)paragraphs.push({type:'paragraph',content:[]});if(line)paragraphs.at(-1).content.push({type:'text',text:line});});
  }
  return {type:'doc',content:paragraphs};
}
// Official yr.buildFinalPrompt: inline referenced text once; prepend unused text sources.
export function projectPrompt(prompt, inputs) {
  const texts=inputs.filter(input=>input.type==='text').map(input=>input.text||''),used=new Set();
  const value=assetSegments(prompt||'').map(part=>typeof part==='string'?part.replace(/(\{\{Text\s*\d+\}\})\s*(?=\{\{Text\s*\d+\}\})/g,'$1\n').replace(/\{\{Text\s*(\d+)\}\}/g,(token,index)=>{const i=Number(index)-1;if(!texts[i])return token;used.add(i);return texts[i];}):part.token).join('');
  return [texts.filter((text,i)=>text&&!used.has(i)).join('\n'),value].filter(Boolean).join('\n');
}

export function projectGenerationPrompt(prompt,inputs,allowed){return projectAssets(projectPrompt(prompt,inputs),inputs,allowed);}
