// Links are public DNS destinations only. The app never fetches result URLs.
export function safePublicUrl(value) {
 if(typeof value!=='string'||value.length>4096||/[\u0000-\u0020\u007f\\]/u.test(value))return null;
 try {
  const url=new URL(value),host=url.hostname.toLowerCase();
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port||host.includes(':')||/^\d[\d.]*$/.test(host))return null;
  if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)||/(?:^|\.)(?:localhost|local|internal|lan|test|invalid|onion)$/.test(host))return null;
  return url.href;
 }catch{return null;}
}
export function validateSearchInput(input) {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['query','allowed_domains','search_context_size'].includes(key)))throw Error('检索参数无效');
 if(typeof input.query!=='string'||!input.query.trim()||input.query.length>2000)throw Error('检索词必须为 1–2000 字符');
 const size=input.search_context_size??'medium';
 if(!['low','medium','high'].includes(size))throw Error('检索上下文档位无效');
 let domains;
 if(input.allowed_domains!==undefined){
  if(!Array.isArray(input.allowed_domains)||!input.allowed_domains.length||input.allowed_domains.length>20)throw Error('检索域名数量无效');
  domains=input.allowed_domains.map(domain=>{
   if(typeof domain!=='string'||domain.length>253||domain!==domain.trim()||!safePublicUrl('https://'+domain)||new URL('https://'+domain).hostname!==domain||/[/?#@:]/.test(domain))throw Error('仅接受公开网站域名，不接受 URL 或本机地址');
   return domain;
  });
  if(new Set(domains).size!==domains.length)throw Error('检索域名不能重复');
 }
 return {query:input.query.trim(),search_context_size:size,...(domains?{allowed_domains:domains}:{})};
}

// Citation annotations can cover factual prose, not merely a footnote token.
// Split only at range ends so every original character survives, including overlaps.
export function citationRuns(text,citations,sources){
 const known=new Map(sources.map(source=>[source.id,source])),ends=new Map();
 for(const entry of citations){
  if(!known.has(entry.sourceId)||!Number.isInteger(entry.start_index)||!Number.isInteger(entry.end_index)||entry.start_index<0||entry.end_index<entry.start_index||entry.end_index>text.length)continue;
  if(!ends.has(entry.end_index))ends.set(entry.end_index,new Map());
  ends.get(entry.end_index).set(entry.sourceId,known.get(entry.sourceId));
 }
 const runs=[];let offset=0;
 for(const [end,linked] of [...ends].sort(([a],[b])=>a-b)){
  runs.push({text:text.slice(offset,end),sources:[...linked.values()]});offset=end;
 }
 runs.push({text:text.slice(offset),sources:[]});return runs;
}
