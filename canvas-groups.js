(function(root){
 'use strict';
 const PAD=20,MAX=50;
 const children=(nodes,id)=>nodes.filter(n=>n.parentId===id);
 function descendants(nodes,ids){
  const result=new Set(ids),links=new Map;
  const append=(from,to)=>{let targets=links.get(from);if(!targets)links.set(from,targets=[]);targets.push(to);};
  // Index both relationships once: reverse-ordered nested groups otherwise rescan
  // the whole graph for every level. Missing pile members can still own children.
  for(const n of nodes){const parent=n.parentId;if(parent)append(parent,n.id);if(n.type==='pile')for(const id of n.memberIds||[])append(n.id,id);}
  const queue=[...result];
  for(let i=0;i<queue.length;i++)for(const id of links.get(queue[i])||[])if(!result.has(id)){result.add(id);queue.push(id);}
  return result;
 }
 function bounds(nodes,padding=PAD){if(!nodes.length)return{x:0,y:0,width:0,height:0};const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y));return{x:x-padding,y:y-padding,width:Math.max(...nodes.map(n=>n.x+n.width))-x+2*padding,height:Math.max(...nodes.map(n=>n.y+n.height))-y+2*padding};}
 function eligible(nodes,ids){const wanted=new Set(ids),picked=nodes.filter(n=>wanted.has(n.id)&&n.type!=='group');if(picked.length<2)return false;if(picked.length>MAX)return false;return !(picked[0].parentId&&picked.every(n=>n.parentId===picked[0].parentId));}
 function group(nodes,ids,id){const selected=new Set(ids),picked=nodes.filter(n=>selected.has(n.id)&&n.type!=='group');if(picked.length<2)throw Error('请选择至少两个节点');if(picked.length>MAX)throw Error('最多可同时打组50个节点');const parents=new Set(picked.map(n=>n.parentId).filter(Boolean));let target=parents.size===1?nodes.find(n=>n.type==='group'&&n.id===[...parents][0]):null;const created=!target;if(!target){target={id,type:'group',title:'新建组',layoutType:'horizontal',createdBy:'client'};nodes.unshift(target);}const members=[...new Set([...children(nodes,target.id),...picked])];Object.assign(target,bounds(members));picked.forEach(n=>n.parentId=target.id);if(created&&parents.size>1)for(let i=nodes.length-1;i>=0;i--)if(parents.has(nodes[i].id)&&!children(nodes,nodes[i].id).length)nodes.splice(i,1);return target;}
 function ungroup(nodes,id){const g=nodes.find(n=>n.id===id&&n.type==='group');if(!g)throw Error('分组不存在');const released=children(nodes,id);released.forEach(n=>delete n.parentId);nodes.splice(nodes.indexOf(g),1);return released.map(n=>n.id);}
 function autoGroup(nodes,ids){const picked=new Set(ids),hidden=new Set(nodes.filter(n=>n.type==='pile').flatMap(n=>n.memberIds||[])),groups=nodes.filter(n=>n.type==='group');for(const n of nodes){if(!picked.has(n.id)||hidden.has(n.id)||['group','comment'].includes(n.type))continue;const parent=groups.find(g=>g.id===n.parentId);if(parent){if(n.x+n.width<parent.x||n.x>parent.x+parent.width||n.y+n.height<parent.y||n.y>parent.y+parent.height)delete n.parentId;continue;}const containing=groups.filter(g=>n.x>=g.x&&n.y>=g.y&&n.x+n.width<=g.x+g.width&&n.y+n.height<=g.y+g.height).sort((a,b)=>a.width*a.height-b.width*b.height);if(containing.length)n.parentId=containing[0].id;}}
 function positions(nodes,ids){const all=descendants(nodes,ids);return nodes.filter(n=>all.has(n.id)).map(n=>({id:n.id,x:n.x,y:n.y}));}
 function translate(nodes,snapshot,dx,dy,snap=false){if(snap&&snapshot.length){dx=Math.round((snapshot[0].x+dx)/20)*20-snapshot[0].x;dy=Math.round((snapshot[0].y+dy)/20)*20-snapshot[0].y;}const map=new Map(nodes.map(n=>[n.id,n]));for(const p of snapshot){const n=map.get(p.id);if(n){n.x=p.x+dx;n.y=p.y+dy;}}}
 function layout(nodes,edges,ids,mode,dagre){const wanted=new Set(ids),selected=nodes.filter(n=>wanted.has(n.id)),groupNode=selected.length===1&&selected[0].type==='group'?selected[0]:null,picked=groupNode?children(nodes,groupNode.id):selected.filter(n=>n.type!=='group');if(!picked.length)throw Error('没有可布局的节点');if(!['grid','horizontal'].includes(mode))throw Error('布局类型无效');const origin=groupNode?{x:groupNode.x,y:groupNode.y}:bounds(picked,0),padding=groupNode?100:0,spacing=200,result=new Map;let width,height;
  if(mode==='grid'){const rows=Math.ceil(Math.sqrt(picked.length)),columns=Math.ceil(picked.length/rows),w=Math.max(...picked.map(n=>n.width)),h=Math.max(...picked.map(n=>n.height));picked.forEach((n,i)=>result.set(n.id,{x:padding+(i%columns)*(w+spacing)+(w-n.width)/2,y:padding+Math.floor(i/columns)*(h+spacing)+(h-n.height)/2}));width=padding*2+columns*w+(columns-1)*spacing;height=padding*2+rows*h+(rows-1)*spacing;
  }else{if(!dagre)throw Error('布局引擎未加载');const graph=new dagre.graphlib.Graph().setDefaultEdgeLabel(()=>({}));graph.setGraph({rankdir:'LR',nodesep:spacing,ranksep:spacing,marginx:padding,marginy:padding});picked.forEach(n=>graph.setNode(n.id,{width:n.width,height:n.height}));const members=new Set(picked.map(n=>n.id));edges.filter(e=>members.has(e.source)&&members.has(e.target)).forEach(e=>graph.setEdge(e.source,e.target));dagre.layout(graph);picked.forEach(n=>{const p=graph.node(n.id);result.set(n.id,{x:p.x-n.width/2,y:p.y-n.height/2});});const minX=Math.min(...[...result.values()].map(p=>p.x)),minY=Math.min(...[...result.values()].map(p=>p.y));result.forEach(p=>{p.x+=padding-minX;p.y+=padding-minY;});width=Math.max(...picked.map(n=>result.get(n.id).x+n.width))+padding;height=Math.max(...picked.map(n=>result.get(n.id).y+n.height))+padding;}
  // Layout changes coordinates only. Index ownership once, but capture each
  // subtree's current positions in graph order after earlier selections moved.
  // A selected pile and its member must retain that sequential behavior.
  const layoutLinks=new Map(),layoutRecords=new Map(),layoutNodes=new Map();
  const append=(from,to)=>{let targets=layoutLinks.get(from);if(!targets)layoutLinks.set(from,targets=[]);targets.push(to);};
  nodes.forEach((node,index)=>{const id=node.id;layoutNodes.set(id,node);let records=layoutRecords.get(id);if(!records)layoutRecords.set(id,records=[]);records.push({node,index});if(node.parentId)append(node.parentId,id);if(node.type==='pile')for(const member of node.memberIds||[])append(id,member);});
  for(const n of picked){
   const p=result.get(n.id),dx=origin.x+p.x-n.x,dy=origin.y+p.y-n.y,all=new Set([n.id]),queue=[n.id];
   for(let i=0;i<queue.length;i++)for(const id of layoutLinks.get(queue[i])||[])if(!all.has(id)){all.add(id);queue.push(id);}
   const snapshot=queue.flatMap(id=>layoutRecords.get(id)||[]).sort((a,b)=>a.index-b.index).map(({node})=>({id:node.id,x:node.x,y:node.y}));
   for(const position of snapshot){const node=layoutNodes.get(position.id);if(node){node.x=position.x+dx;node.y=position.y+dy;}}
  }
  if(groupNode)Object.assign(groupNode,{width,height,layoutType:mode});return{width,height,ids:picked.map(n=>n.id)};
 }
 function resizeBounds(start,handle,dx,dy){const b={...start},min=10;if(handle.includes('w')){b.x=Math.min(start.x+dx,start.x+start.width-min);b.width=start.width+start.x-b.x;}if(handle.includes('e'))b.width=Math.max(min,start.width+dx);if(handle.includes('n')){b.y=Math.min(start.y+dy,start.y+start.height-min);b.height=start.height+start.y-b.y;}if(handle.includes('s'))b.height=Math.max(min,start.height+dy);return b;}
 const api={bounds,children,descendants,eligible,group,ungroup,autoGroup,positions,translate,layout,resizeBounds};if(typeof module!=='undefined')module.exports=api;else root.CanvasGroups=api;
})(typeof window!=='undefined'?window:globalThis);
