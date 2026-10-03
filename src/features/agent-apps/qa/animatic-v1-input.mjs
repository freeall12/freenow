const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
export function animaticV1QaRawArgs(record){
 const stored=record.qaRawArgs??record.args,data=stored?.data??record.result?.response,sources=record.result?.animaticV1SourceContext?.sources??[];
 if(!data||!Array.isArray(data.sheets))throw Error('历史验收记录缺少原始镜头参数');
 const raw=pick(data,['version','locale','title']);raw.sheets=data.sheets.map((sheet,index)=>{
  const source=pick(sheet,['sheet_id','label','cells']),node_ref=sheet.node_ref??sources.find(row=>row.node_ref===sheet.sheet_node_ref)?.node_ref??sources[index]?.node_ref;
  if(typeof node_ref!=='string'||!/^node\/[A-Za-z0-9_-]{1,180}$/.test(node_ref))throw Error('历史验收记录无法恢复真实故事板node_ref');
  source.node_ref=node_ref;source.shots=sheet.shots.map(shot=>pick(shot,['shot_code','cell','duration','move','transition','size','script_text']));return source;
 });
 return {resource_uri:'ui://tapnow/animatic@v1',...pick(stored,['title']),data:raw};
}
// Preserve stored pixels and responses, but keep readback UI small and editable.
export function animaticV1QaSavedSummary(chat){return {id:chat.id,nodes:chat.qaGraph?.nodes.map(node=>({id:node.id,type:node.type,title:node.title,image_chars:(node.fullImage||node.image||'').length})),messages:chat.messages.map(record=>({id:record.id,status:record.status,raw_args:record.name==='show_app'?animaticV1QaRawArgs(record):undefined,saved_state:record.appState,confirmed_handoffs:record.appHandoffs,sources:record.result?.animaticV1SourceContext?.sources})),queuedMessages:chat.queuedMessages};}
