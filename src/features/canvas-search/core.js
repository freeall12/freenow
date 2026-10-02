(function(root){
 'use strict';
 const fields={title:0,prompt:1,text:2},types={image:0,studio:0,world:0,threeD:0,video:1,text:2,audio:3,group:4};
 const normalize=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[\s_.\-/]+/g,' ').toLocaleLowerCase().normalize('NFKC').trim();
 const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'word'}):null;
 const words=value=>segmenter?Array.from(segmenter.segment(value)).filter(s=>s.isWordLike).map(s=>s.segment):value.match(/[\p{L}\p{N}]+/gu)||[];
 const tokens=value=>value.includes(' ')?value.split(' ').filter(Boolean):words(value);
 const compact=value=>Array.from(value.replace(/\s/g,''));
 function distance(a,b,max){a=compact(a);b=compact(b);if(Math.abs(a.length-b.length)>max)return null;let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const next=[i+1];for(let j=0;j<b.length;j++)next.push(Math.min(row[j+1]+1,next[j]+1,row[j]+(a[i]===b[j]?0:1)));if(Math.min(...next)>max)return null;row=next;}return row[b.length]<=max?row[b.length]:null;}
 function score(value,query){
  if(value===query)return 0;if(value.startsWith(query))return 6+(value.length-query.length)*.01;const candidates=[],parts=words(value),length=compact(query).length,max=length<4?0:length>=8?2:1;
  parts.forEach((part,i)=>{if(part===query)candidates.push(12+i*1.5);else if(part.startsWith(query))candidates.push(16+i*1.5+(part.length-query.length)*.02);else if(max){const d=distance(part,query,max);if(d!==null)candidates.push(42+d*10+i*1.5+Math.max(0,part.length-query.length)*.05);}});
  if(length>=2){const initials=parts.map(p=>compact(p)[0]||'').join('');if(initials===query)candidates.push(14);else if(initials.startsWith(query))candidates.push(18+(initials.length-query.length)*.3);else if(initials.includes(query))candidates.push(24+initials.indexOf(query)*1.5);}
  const at=value.indexOf(query);if(at>=0)candidates.push(28+at*.25+Math.max(0,value.length-query.length)*.01);
  if(length>=(Array.from(query).some(c=>c.codePointAt(0)>127)?2:3)){let start=-1,last=-1,gaps=0,adjacent=0,cursor=0,found=true;for(const c of compact(query)){const i=value.indexOf(c,cursor);if(i<0){found=false;break;}if(start<0)start=i;else{gaps+=Math.max(0,i-last-1);if(i===last+1)adjacent++;}last=i;cursor=i+1;}if(found)candidates.push(72+start*.8+gaps*.55+Math.max(0,value.length-query.length)*.02-adjacent*1.5);}
  return candidates.length?Math.min(...candidates):null;
 }
 function category(node){return ['studio','world','threeD'].includes(node.type)?'world':node.type;}
 function index(nodes,configs={}){return nodes.flatMap((node,position)=>{if(node.hidden||node.type==='docEditor')return [];const config=node.generation||configs[node.id]||{},entries=[];for(const [field,value]of [['title',node.title],['prompt',node.prompt],['prompt',node.params?.prompt],['prompt',config.prompt],['text',node.content],['text',node.text]]){const normalized=normalize(value);if(normalized&&!entries.some(e=>e.field===field&&e.normalized===normalized))entries.push({field,value:String(value).trim(),normalized});}return entries.length?[{node,position,title:node.title||node.type,entries}]:[];});}
 function query(documents,input='',filter='all',limit=30){
  const q=normalize(input),terms=tokens(q),results=[];
  for(const document of documents){if(filter!=='all'&&category(document.node)!==filter)continue;if(!q){results.push({document,field:'title',score:0});continue;}let best=null;
   const keep=(value,field)=>{if(value!==null&&(!best||value<best.score||value===best.score&&fields[field]<fields[best.field]))best={document,field,score:value};};
   for(const entry of document.entries){const whole=score(entry.normalized,q),parts=terms.map(t=>score(entry.normalized,t));if(parts.every(p=>p!==null))keep(whole===null?parts.reduce((a,b)=>a+b,0)/parts.length:Math.min(whole,parts.reduce((a,b)=>a+b,0)/parts.length),entry.field);}
   if(terms.length>1){const parts=terms.map(t=>document.entries.map(e=>({entry:e,score:score(e.normalized,t)})).filter(r=>r.score!==null).sort((a,b)=>a.score-b.score||fields[a.entry.field]-fields[b.entry.field])[0]);if(parts.every(Boolean)){const used=new Set(parts.map(p=>p.entry.field+':'+p.entry.normalized)),field=parts.map(p=>p.entry.field).sort((a,b)=>fields[a]-fields[b])[0];keep(parts.reduce((sum,p)=>sum+p.score,0)/parts.length+(used.size>1?4:0),field);}}
   if(best)results.push(best);
  }
  return results.sort((a,b)=>a.score-b.score||fields[a.field]-fields[b.field]||(types[a.document.node.type]??5)-(types[b.document.node.type]??5)||a.document.position-b.document.position).slice(0,limit);
 }
 function fit(bounds,viewport,padding=.35,zoom={min:.15,max:2}){
  const padX=Math.floor((viewport.width-viewport.width/(1+padding))*.5),padY=Math.floor((viewport.height-viewport.height/(1+padding))*.5),scale=Math.max(zoom.min,Math.min(zoom.max,(viewport.width-padX*2)/bounds.width,(viewport.height-padY*2)/bounds.height));
  let x=viewport.width/2-(bounds.x+bounds.width/2)*scale,y=viewport.height/2-(bounds.y+bounds.height/2)*scale;
  // Match the canvas library's integer padding, including subpixel overflow correction.
  const left=Math.min(Math.floor(bounds.x*scale+x)-padX,0),right=Math.min(Math.floor(viewport.width-((bounds.x+bounds.width)*scale+x))-padX,0),top=Math.min(Math.floor(bounds.y*scale+y)-padY,0),bottom=Math.min(Math.floor(viewport.height-((bounds.y+bounds.height)*scale+y))-padY,0);
  return {scale,x:x-left+right,y:y-top+bottom};
 }
 const api={normalize,index,query,category,fit};if(typeof module!=='undefined')module.exports=api;else root.CanvasSearch=api;
})(typeof window!=='undefined'?window:globalThis);
