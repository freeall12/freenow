/* TapNow pile geometry: member IDs stay real nodes; display positions never replace world coordinates. */
(function(root){
 'use strict';
 const types=['image','video','audio','text'];
 function index(nodes){
  const owner=new Map(),members=new Map(),byId=new Map(),pileNodes=[];
  // Graph frames need both lookups. One pass avoids allocating an [id,node]
  // pair for every node and filtering the whole graph twice.
  for(const node of nodes){byId.set(node.id,node);if(node.type==='pile')pileNodes.push(node);}
  for(const pile of [...pileNodes].sort((a,b)=>a.id.localeCompare(b.id)))for(const id of new Set(pile.memberIds||[])){const n=byId.get(id);if(n&&types.includes(n.type)&&!owner.has(id))owner.set(id,pile.id);}
  for(const pile of pileNodes)members.set(pile.id,(pile.memberIds||[]).filter((id,i,a)=>a.indexOf(id)===i&&owner.get(id)===pile.id).map(id=>byId.get(id)));
  return{owner,members};
 }
 function displaySize(n){const ratio=n.type==='text'?Math.min(320/n.width,320/n.height,1):1;return{width:n.width*ratio,height:n.height*ratio};}
 function size(members){const visible=members.slice(-5).map(displaySize);return{width:Math.max(1,...visible.map(n=>n.width)),height:Math.max(1,...visible.map(n=>n.height))};}
 function resized(pile,members){const s=size(members);return{...s,x:pile.x+(pile.width-s.width)/2,y:pile.y+(pile.height-s.height)/2};}
 function planFromIndex(ids,state,byId){const sources=[...new Set(ids)].map(id=>byId.get(id)).filter(n=>n?.type!=='group');if(sources.length<2||sources.some(n=>!n||n.type!=='pile'&&(!types.includes(n.type)||state.owner.has(n.id))))return null;const members=[...new Map(sources.flatMap(n=>n.type==='pile'?state.members.get(n.id):[n]).map(n=>[n.id,n])).values()];if(members.length<2||members.length>50)return null;const parent=sources[0].parentId;return{sources,members,parentId:parent&&sources.every(n=>n.parentId===parent)?parent:undefined};}
 function plan(nodes,ids){return planFromIndex(ids,index(nodes),new Map(nodes.map(n=>[n.id,n])));}
 // A pointer sample may overlap many full piles. Share only within this call:
 // membership can change in place between samples, including undo and async jobs.
 function dropTarget(nodes,point,excluded=[],sources=[]){
  const excludedIds=new Set(excluded);let state,byId;
  return nodes.find(n=>{
   if(n.type!=='pile'||excludedIds.has(n.id)||!(point.x>=n.x&&point.x<=n.x+n.width&&point.y>=n.y&&point.y<=n.y+n.height))return false;
   if(!sources.length)return true;
   state ||= index(nodes);byId ||= new Map(nodes.map(node=>[node.id,node]));
   return !!planFromIndex([n.id,...sources],state,byId);
  });
 }
 function stack(nodes,ids,id){const p=plan(nodes,ids);if(!p)throw Error('请选择2–50个可堆叠的图片、视频、音频或文本节点');const s=size(p.members),x=Math.min(...p.sources.map(n=>n.x)),y=Math.min(...p.sources.map(n=>n.y)),right=Math.max(...p.sources.map(n=>n.x+n.width)),bottom=Math.max(...p.sources.map(n=>n.y+n.height));const pile={id,type:'pile',title:'堆叠',x:(x+right-s.width)/2,y:(y+bottom-s.height)/2,...s,parentId:p.parentId,memberIds:p.members.map(n=>n.id)};p.members.forEach(n=>delete n.parentId);const removed=new Set(p.sources.filter(n=>n.type==='pile').map(n=>n.id));for(let i=nodes.length-1;i>=0;i--)if(removed.has(nodes[i].id))nodes.splice(i,1);nodes.push(pile);return pile;}
 function scatter(pile,members){if(!members.length)return[];const count=Math.max(1,Math.round(Math.sqrt(members.length))),counts=Array(count).fill(Math.floor(members.length/count)),rank=Array.from({length:count},(_,i)=>i).sort((a,b)=>Math.abs(a-(count-1)/2)-Math.abs(b-(count-1)/2)||a-b);for(let i=0;i<members.length%count;i++)counts[rank[i]]++;const slots=counts.flatMap((c,row)=>Array.from({length:c},(_,column)=>({row,column,distance:(column-(c-1)/2)**2+(row-(count-1)/2)**2}))).sort((a,b)=>a.distance-b.distance||a.row-b.row||a.column-b.column),ordered=[...members].reverse().map((member,i)=>({...slots[i],member,animationIndex:i}));const rows=counts.map((_,i)=>ordered.filter(v=>v.row===i).sort((a,b)=>a.column-b.column)),sizes=rows.map(row=>({width:row.reduce((s,v)=>s+v.member.width,0)+(row.length-1)*128,height:Math.max(...row.map(v=>v.member.height))})),height=sizes.reduce((s,v)=>s+v.height,0)+(count-1)*128,result=[];let y=pile.y+pile.height/2-height/2;rows.forEach((row,i)=>{let x=pile.x+pile.width/2-sizes[i].width/2;row.forEach(v=>{result.push({id:v.member.id,x,y:y+(sizes[i].height-v.member.height)/2,animationIndex:v.animationIndex});x+=v.member.width+128;});y+=sizes[i].height+128;});return result;}
 function unstack(nodes,id){const pile=nodes.find(n=>n.id===id&&n.type==='pile');if(!pile)throw Error('堆叠不存在');const members=index(nodes).members.get(id),positions=scatter({...pile,...resized(pile,members)},members);for(const p of positions){const n=members.find(n=>n.id===p.id);n.x=p.x;n.y=p.y;delete n.parentId;}nodes.splice(nodes.indexOf(pile),1);return positions;}
 function release(nodes,pileId,id,point){if(![point.x,point.y].every(Number.isFinite))throw Error('落点坐标无效');const pile=nodes.find(n=>n.id===pileId&&n.type==='pile'),state=index(nodes);if(!pile||state.owner.get(id)!==pileId)throw Error('节点不在该堆叠中');const members=state.members.get(pileId),left=members.filter(n=>n.id!==id),n=members.find(n=>n.id===id);Object.assign(n,point);delete n.parentId;if(left.length<2){for(const child of left){child.x=pile.x+pile.width/2-child.width/2;child.y=pile.y+pile.height/2-child.height/2;delete child.parentId;}nodes.splice(nodes.indexOf(pile),1);}else{Object.assign(pile,resized(pile,left));pile.memberIds=left.map(n=>n.id);}return n;}
 function join(nodes,targetId,ids){const target=nodes.find(n=>n.id===targetId&&n.type==='pile');if(!target)throw Error('目标堆叠不存在');const p=plan(nodes,[targetId,...ids]);if(!p)throw Error('无法加入该堆叠，最多50个节点');const targetMembers=index(nodes).members.get(targetId),added=p.members.filter(n=>!targetMembers.some(t=>t.id===n.id)),members=[...targetMembers,...added];Object.assign(target,resized(target,members));target.memberIds=members.map(n=>n.id);members.forEach(n=>delete n.parentId);for(let i=nodes.length-1;i>=0;i--)if(nodes[i].type==='pile'&&nodes[i].id!==targetId&&p.sources.includes(nodes[i]))nodes.splice(i,1);return target;}
 function gallery(members){const rows=[];for(const n of members){const item={id:n.id,...displaySize(n)},row=rows.at(-1);if(!row||row.width+56+item.width>1872)rows.push({items:[item],width:item.width,height:40+item.height});else{row.items.push(item);row.width+=56+item.width;row.height=Math.max(row.height,40+item.height);}}const width=Math.max(0,...rows.map(r=>r.width)),height=rows.reduce((s,r)=>s+r.height,0)+Math.max(0,rows.length-1)*56,items=[];let y=-height/2;for(const row of rows){let x=-row.width/2;for(const item of row.items){items.push({...item,x,y:y+40});x+=item.width+56;}y+=row.height+56;}return{items,bounds:{left:-width/2-112,right:width/2+112,top:-height/2-112,bottom:height/2+112}};}
 function reconcile(nodes){const state=index(nodes),removed=[];for(const pile of nodes.filter(n=>n.type==='pile')){const members=state.members.get(pile.id);if(members.length<2){for(const n of members){n.x=pile.x+(pile.width-n.width)/2;n.y=pile.y+(pile.height-n.height)/2;delete n.parentId;}nodes.splice(nodes.indexOf(pile),1);removed.push(pile.id);}else{pile.memberIds=members.map(n=>n.id);Object.assign(pile,resized(pile,members));members.forEach(n=>delete n.parentId);}}return removed;}
 const api={reconcile,index,displaySize,size,plan,dropTarget,stack,scatter,unstack,release,join,gallery};if(typeof module!=='undefined')module.exports=api;else root.CanvasPiles=api;
})(typeof window!=='undefined'?window:globalThis);
