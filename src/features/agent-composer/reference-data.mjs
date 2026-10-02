export const libraryFolders=['角色','场景','道具','风格','音效','Others'];
export function referenceNodes(doc){const result=[];const visit=node=>{if(node?.type==='referenceMention')result.push({...node.attrs});for(const child of node?.content||[])visit(child);};visit(doc);return result;}
export function nodeOptions(nodes,query=''){
 const all=nodes.filter(n=>['text','image','video','audio','model','studio'].includes(n.type)).map((n,index)=>({kind:'node',id:n.id,label:n.title||n.type,mediaType:n.type,number:index+1,image:n.image}));
 const index=query.match(/^#?(\d+)$/);return (index?all.filter(n=>n.number===Number(index[1])):all.filter(n=>n.label.toLowerCase().includes(query.toLowerCase()))).slice(0,20);
}
export function libraryScope(item){return item.scope==='team'?'team':'personal';}
export function resolveReferenceData(refs,data){const materials=[],seen=new Set();for(const ref of refs){if(ref.kind==='app')continue;let items;
 if(ref.kind==='node'){const node=data.nodes.find(n=>n.id===ref.id);if(!node)throw Error('引用的画布素材已删除：'+ref.label);items=[{...node,name:node.title,source:'canvas'}];}
 else if(ref.kind==='library'){const item=data.library.find(n=>n.id===ref.id&&libraryScope(n)===ref.scope);if(!item)throw Error('引用的素材库文件已删除：'+ref.label);items=[{...item,source:'library'}];}
 else if(ref.kind==='folder')items=data.library.filter(n=>n.folder===ref.id&&libraryScope(n)===ref.scope).map(n=>({...n,source:'library'}));
 else throw Error('不支持的引用类型');
 for(const item of items){const key=item.source+':'+(item.source==='library'?libraryScope(item)+':':'')+item.id;if(!seen.has(key)){seen.add(key);materials.push(item);}}
 }return materials;}
