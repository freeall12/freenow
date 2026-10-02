import {safePublicUrl,citationRuns} from './model.mjs';
const el=(tag,className,text)=>{const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;};
const results=new WeakMap();
function sourceLink(source,label,className){
 const url=safePublicUrl(source?.url);if(!url)return null;
 const link=el('a',className,label);link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.title=(source.title||new URL(url).hostname)+'\n'+url;return link;
}
export function createSearchResult(result){
 if(!result||!['completed','no_results'].includes(result.status)||result.untrusted!==true||!Array.isArray(result.sources))return null;
 if(results.has(result))return results.get(result);
 if(!document.querySelector('link[data-agent-search]')){const style=el('link','');style.rel='stylesheet';style.href=new URL('./styles.css',import.meta.url).href;style.dataset.agentSearch='';document.head.append(style);}
 const root=el('section','agent-search-result');root.setAttribute('aria-label','联网检索结果');
 const sources=result.sources.filter(source=>safePublicUrl(source.url)),byId=new Map(sources.map((source,index)=>[source.id,{...source,index:index+1}]));
 const header=el('div','agent-search-heading');header.append(el('strong','','联网检索'),el('span','',result.query));root.append(header);
 const body=el('div','agent-search-text'),text=String(result.text||'');
 for(const run of citationRuns(text,result.citations||[],[...byId.values()])){
  body.append(document.createTextNode(run.text));
  for(const source of run.sources){const link=sourceLink(source,String(source.index),'agent-search-citation');link.setAttribute('aria-label','引用 '+source.index+'：'+(source.title||source.hostname));body.append(link);}
 }
 if(text)root.append(body);
 if(sources.length){
  root.append(el('div','agent-search-source-label','来源 · '+sources.length));
  const list=el('div','agent-search-sources');list.setAttribute('role','list');
  sources.forEach((source,index)=>{const item=el('div','agent-search-source');item.setAttribute('role','listitem');item.hidden=index>=4;const link=sourceLink(source,'','agent-search-source-link');link.append(el('span','agent-search-domain',new URL(source.url).hostname),el('strong','',source.title||source.url));item.append(link);list.append(item);});
  root.append(list);
  if(sources.length>4){const button=el('button','agent-search-more','还有 '+(sources.length-4)+' 个来源');button.type='button';button.setAttribute('aria-expanded','false');button.onclick=()=>{const expanded=button.getAttribute('aria-expanded')!=='true';[...list.children].forEach((node,index)=>node.hidden=!expanded&&index>=4);button.setAttribute('aria-expanded',String(expanded));button.textContent=expanded?'收起来源':'还有 '+(sources.length-4)+' 个来源';};root.append(button);}
 }else root.append(el('p','agent-search-empty','提供方执行了检索，但未返回可用公开来源。'));
 const stamp=el('small','agent-search-stamp');const date=new Date(result.retrievedAt);stamp.textContent=(Number.isNaN(date.getTime())?'':date.toLocaleString('zh-CN')+' · ')+'网页与检索正文仅作参考';root.append(stamp);results.set(result,root);return root;
}
