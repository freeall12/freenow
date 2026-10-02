(function(root){
 'use strict';
 const clone=x=>structuredClone(x);
 function capture(nodes,edges,groupId,getConfig=n=>n.generation){
  const group=nodes.find(n=>n.id===groupId&&n.type==='group');if(!group)throw Error('分组不存在');
  const ids=new Set([groupId]);let changed=true;while(changed){changed=false;for(const n of nodes){if(ids.has(n.parentId)&&!ids.has(n.id)){ids.add(n.id);changed=true;}if(n.type==='pile'&&ids.has(n.id))for(const id of n.memberIds||[])if(!ids.has(id)){ids.add(id);changed=true;}}}
  const members=nodes.filter(n=>ids.has(n.id)&&n.id!==groupId);if(!members.length)throw Error('分组内没有节点');if(members.some(n=>n.type==='studio'))throw Error('3D 片场暂不支持保存为模板');
  const hidden=new Set(members.filter(n=>n.type==='pile').flatMap(n=>n.memberIds||[])),visible=members.filter(n=>!hidden.has(n.id));const x=Math.min(...visible.map(n=>n.x)),y=Math.min(...visible.map(n=>n.y));
  const copied=members.map(n=>{const value=clone(n);value.x=n.x-x+40;value.y=n.y-y+40;if(value.parentId===groupId)delete value.parentId;const config=getConfig(n);if(config)value.generation=clone(config);delete value.sourceId;return value;});
  const internal=edges.filter(e=>ids.has(e.source)&&ids.has(e.target)&&e.source!==groupId&&e.target!==groupId).map(e=>{const value=clone(e);delete value.path;return value;});
  return {version:1,nodes:copied,edges:internal,width:Math.max(...copied.filter(n=>!hidden.has(n.id)).map(n=>n.x+n.width))+40,height:Math.max(...copied.filter(n=>!hidden.has(n.id)).map(n=>n.y+n.height))+40,groupColor:group.groupColor||''};
 }
 function remapConfig(value,ids,key=''){
  if(Array.isArray(value))return value.map(v=>remapConfig(v,ids,key)).filter(v=>v!==undefined);
  if(value&&typeof value==='object'){if(typeof value.id==='string'&&['references','refs'].includes(key)&&!ids.has(value.id))return undefined;const result={};for(const [k,v]of Object.entries(value)){const mapped=remapConfig(v,ids,k);if(mapped!==undefined)result[k]=mapped;}return result;}
  if(typeof value==='string'&&key==='referenceBindings')return ids.get(value)||null;
  if(typeof value==='string'&&['referenceOrder','referenceKey'].includes(key)&&value.startsWith('node:'))return ids.has(value.slice(5))?'node:'+ids.get(value.slice(5)):undefined;
  if(typeof value==='string'&&['id','nodeId','sourceId','parentId','referenceIds'].includes(key))return ids.get(value);
  return value;
 }
 function instantiate(template,point,idFactory=()=>crypto.randomUUID()){
  const g=template.graph;if(g?.version!==1||!Array.isArray(g.nodes)||!g.nodes.length||!Array.isArray(g.edges))throw Error('模板节点数据不完整');
  if(![point.x,point.y,g.width,g.height].every(Number.isFinite)||g.width<=0||g.height<=0||new Set(g.nodes.map(n=>n.id)).size!==g.nodes.length||g.nodes.some(n=>n.type==='studio'||![n.x,n.y,n.width,n.height].every(Number.isFinite)||n.width<=0||n.height<=0))throw Error('模板节点数据无效');
  const groupId=idFactory(),ids=new Map(g.nodes.map(n=>[n.id,idFactory()]));
  if(g.nodes.some(n=>n.type==='pile'&&(!Array.isArray(n.memberIds)||n.memberIds.length<2||n.memberIds.length>50||new Set(n.memberIds).size!==n.memberIds.length||n.memberIds.some(id=>!g.nodes.some(m=>m.id===id&&['image','video','audio','text'].includes(m.type)))))||g.nodes.some(n=>n.parentId&&!ids.has(n.parentId))||g.edges.some(e=>!ids.has(e.source)||!ids.has(e.target)))throw Error('模板包含无效引用');
  const group={id:groupId,type:'group',title:template.name,x:point.x,y:point.y,width:g.width,height:g.height,groupColor:g.groupColor};
  const hidden=new Set(g.nodes.filter(n=>n.type==='pile').flatMap(n=>n.memberIds));
  const nodes=g.nodes.map(n=>({...clone(n),id:ids.get(n.id),parentId:hidden.has(n.id)?undefined:ids.get(n.parentId)||groupId,memberIds:n.memberIds?.map(id=>ids.get(id)),...(n.clips?{clips:n.clips.map(c=>({...clone(c),id:idFactory(),sourceId:ids.get(c.sourceId)}))}:{}),x:point.x+n.x,y:point.y+n.y,generation:n.generation?remapConfig(n.generation,ids):undefined,audioConfig:n.audioConfig?remapConfig(n.audioConfig,ids):undefined}));
  return {group,nodes:[group,...nodes],edges:g.edges.map(e=>({...clone(e),id:idFactory(),source:ids.get(e.source),target:ids.get(e.target),path:undefined}))};
 }
 const api={capture,instantiate};if(typeof module!=='undefined')module.exports=api;else root.TemplatesCore=api;
})(typeof window!=='undefined'?window:globalThis);
