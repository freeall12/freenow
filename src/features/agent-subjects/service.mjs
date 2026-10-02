import {assetFromNode,getSubjectStore} from '../subject-library/store.mjs';
import {subjectToken} from '../subject-library/model.mjs';
import {applySubject} from '../subject-library/apply.mjs';
import {isStaticAssetRef} from '../local-resource-migration/index-format.mjs';
import {importIndexedAsset} from '../local-resource-migration/import-asset.mjs';

const fail=(code,message,details={})=>Object.assign(Error(message),{code,...details});
const abort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('主体操作已取消','AbortError');};
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const id=(value,label='ID')=>{if(typeof value!=='string'||!value.trim()||value.length>180||/[\s:{}]/.test(value))throw fail('invalid_request',label+' 无效');return value;};
const expected=value=>{if(typeof value!=='string'||!/^([a-f0-9]{64}|0)$/.test(value))throw fail('invalid_version','请先读取主体取得实际内容版本');return value;};
const content=subject=>canonical({id:subject.id,scope:subject.scope,name:subject.name,description:subject.description||'',assets:subject.assets,archived:!!subject.deletedAt});
const nodeContent=node=>canonical({type:node.type,title:node.title,image:node.image,fullImage:node.fullImage,video:node.video,audio:node.audio,content:node.content,textMode:node.textMode,audioMode:node.audioMode,clip:node.clip,trim:node.trim,duration:node.duration,durationMs:node.durationMs,videoMetadata:node.videoMetadata,audioMetadata:node.audioMetadata,imageMetadata:node.imageMetadata});
const page=(offset=0,limit=30,max=50)=>{if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>max)throw fail('invalid_page','分页范围无效');return {offset,limit};};
const supported=new Set(['image','video','audio','text']);
const readable=value=>String(value||'').replace(/\b(?:data:[^\s"'<>)]*|blob:[^\s"'<>)]*)/gi,source=>source.toLowerCase().startsWith('blob:')?'[omitted blob media]':'[omitted data media]');

// UI and Agent use one committed subject snapshot and await the durable receipt.
export function createSubjectAgentService({app=globalThis.CanvasApp,storage=globalThis.localStorage,storageKey,subjectStore,
  store=globalThis.CanvasStore,canvasStore=store,localAssets=globalThis.LocalAssets,localMedia=globalThis.LocalMedia,fetchImpl=(...args)=>fetch(...args),apply=applySubject,fromNode=assetFromNode,hash=digest,hashBytes,createId=()=>crypto.randomUUID(),now=Date.now,
  notify=()=>globalThis.document?.dispatchEvent(new Event('subjects:changed')),resolveUrl}={}){
  if(typeof app?.getState!=='function')throw TypeError('Canvas adapter is required');
  const library=subjectStore||getSubjectStore({storage,store,storageKey,notify});
  const imports=new Map(),operationKinds=new Map();
  function reserve(operationId,action){const previous=operationKinds.get(operationId);if(previous&&previous!==action)throw fail('operation_conflict','operationId 已绑定另一类主体操作');operationKinds.set(operationId,action);}
  function noImportOperation(operationId){if(imports.has(operationId)||app.getState().nodes.some(node=>node.provenance?.subjectImport?.operationId===operationId))throw fail('operation_conflict','operationId 已绑定主体导入操作');}
  const load=()=>library.snapshot();
  function personal(items,subjectId,{archived=false}={}){const s=items.find(s=>s.id===subjectId);if(!s||s.scope!=='personal'||!archived&&s.deletedAt)throw fail('subject_unavailable','个人主体不存在或已归档');return s;}
  async function version(subject){return hash(content(subject));}
  function summary(subject,version,details=false){
    const counts=Object.fromEntries([...supported].map(type=>[type,subject.assets.filter(a=>a?.type===type).length]));
    return {id:subject.id,name:readable(subject.name),description:readable(subject.description).slice(0,details?8000:500),scope:'personal',version,token:subjectToken(subject),archived:!!subject.deletedAt,assetCount:subject.assets.length,counts,
      ...(details?{assets:subject.assets.map(a=>({id:a.id,type:a.type,name:readable(a.name),...(a.sourceNodeId?{sourceNodeId:a.sourceNodeId}:{}),hasMedia:typeof a.url==='string'&&!!a.url,hasPoster:typeof a.image==='string'&&!!a.image,textLength:typeof a.text==='string'?readable(a.text).length:0,...(a.type==='text'?{textPreview:readable(a.text).slice(0,200)}:{}),...(Number.isFinite(a.durationMs)?{durationMs:a.durationMs}:{})}))}:{})};
  }
  async function list({query='',offset=0,limit=30}={}){
    await library.ready();page(offset,limit);if(typeof query!=='string'||query.length>200)throw fail('invalid_request','搜索词无效');
    const filtered=load().items.filter(s=>s.scope==='personal'&&!s.deletedAt&&((s.name||'')+' '+(s.description||'')).toLowerCase().includes(query.toLowerCase()));
    return {subjects:await Promise.all(filtered.slice(offset,offset+limit).map(async s=>summary(s,await version(s)))),total:filtered.length,offset,nextOffset:offset+limit<filtered.length?offset+limit:null};
  }
  async function read({id:subjectId,assetId,offset=0,limit=2000}){
    await library.ready();id(subjectId);page(offset,limit,8000);const subject=personal(load().items,subjectId),result={subject:summary(subject,await version(subject),true)};
    if(assetId!=null){id(assetId,'素材 ID');const asset=subject.assets.find(a=>a.id===assetId);if(!asset||asset.type!=='text')throw fail('asset_unavailable','请选择主体中的文本素材进行分页读取');const text=readable(asset.text);result.text={assetId,offset,totalLength:text.length,text:text.slice(offset,offset+limit),nextOffset:offset+limit<text.length?offset+limit:null,offsetUnit:'UTF-16 code units after media redaction'};}
    return result;
  }
  function findOperation(items,operationId){for(const subject of items){const records=subject.agentOperations;if(records!=null&&!Array.isArray(records))throw fail('invalid_receipt','主体操作记录损坏，未修改数据');const record=records?.find(record=>record.operationId===operationId);if(record)return {subject,record};}return null;}
  async function replay(found,fingerprint){
    if(found.subject.scope!=='personal'||found.record.fingerprint!==fingerprint)throw fail('operation_conflict','operationId 已绑定其他主体操作');
    const currentVersion=await version(found.subject);return {operationId:found.record.operationId,action:found.record.action,saved:true,applied:true,replayed:true,committedVersion:found.record.version,currentMatches:currentVersion===found.record.version,subject:summary(found.subject,currentVersion,true)};
  }
  async function write(snapshot,items,signal,guard=()=>{}){
    await library.write(snapshot,items,{guard:()=>{abort(signal);guard();}});
  }
  async function save(input,{signal}={}){
    await library.ready();abort(signal);const operationId=id(input.operationId,'operationId'),expectedVersion=expected(input.expectedVersion),subjectId=input.id==null?null:id(input.id);
    if(subjectId&&expectedVersion==='0'||!subjectId&&expectedVersion!=='0')throw fail('invalid_version','新建主体不传 id 并使用版本 0；更新必须传 id 和实际内容版本');
    reserve(operationId,'save');noImportOperation(operationId);
    const name=typeof input.name==='string'?input.name.trim():'',description=input.description==null?'':input.description;
    if(!name||name.length>50||typeof description!=='string'||description.length>8000)throw fail('invalid_request','名称为 1–50 字符，描述最多 8000 字符');
    const nodeIds=input.nodeIds;if(!Array.isArray(nodeIds)||!nodeIds.length||nodeIds.length>100||new Set(nodeIds).size!==nodeIds.length)throw fail('invalid_request','请选择 1–100 个不同的画布素材节点');nodeIds.forEach(value=>id(value,'节点 ID'));
    const request={action:'save',operationId,id:subjectId,expectedVersion,name,description:description.trim(),nodeIds:[...nodeIds]},fingerprint=await hash(canonical(request));abort(signal);
    const snapshot=load(),found=findOperation(snapshot.items,operationId);if(found)return replay(found,fingerprint);
    const previous=subjectId?snapshot.items.find(s=>s.id===subjectId):null;
    if(previous?.scope!=='personal'||previous?.deletedAt){if(previous)throw fail('subject_unavailable','仅支持未归档的个人主体');}
    if(previous?await version(previous)!==expectedVersion:expectedVersion!=='0')throw fail('version_conflict','主体内容版本已变化，请先重新读取');
    const sourceNodes=nodeIds.map(nodeId=>{const node=app.getState().nodes.find(n=>n.id===nodeId);if(!node||!supported.has(node.type))throw fail('node_unavailable','只支持实际画布图片、视频、音频、文本节点');if(node.clip!=null||node.trim!=null)throw fail('clip_requires_export','裁剪节点请先使用 video_trim 导出真实视频，再加入主体');return node;});
    const assets=sourceNodes.map(node=>{const asset=structuredClone(fromNode(structuredClone(node)));if(asset.type!=='text'&&(typeof asset.url!=='string'||!asset.url||! /^(asset:|https?:|blob:|data:(image|video|audio)\/)/i.test(asset.url)&&!isStaticAssetRef(asset.url)))throw fail('media_unavailable','素材没有可持久化实际媒体，请先导入或导出该素材');if(asset.type==='text'&&typeof asset.text!=='string')asset.text='';return asset;});
    const sourceKeys=sourceNodes.map(node=>canonical(fromNode(node))),sourceGuard=()=>{abort(signal);for(const [index,node]of sourceNodes.entries())if(!app.getState().nodes.includes(node)||canonical(fromNode(node))!==sourceKeys[index]||node.clip!=null||node.trim!=null)throw fail('source_changed','保存期间画布素材已变化');};
    const localized=new Map();let resourceIndex;
    for(const asset of assets)for(const field of ['url','image']){
      const source=asset[field],staticRef=isStaticAssetRef(source);if(typeof source!=='string'||! /^(data:|blob:)/i.test(source)&&!staticRef)continue;
      if(typeof localAssets?.put!=='function'){if(source.startsWith('blob:')||staticRef)throw fail('media_unavailable','临时或静态素材需要先写入本地素材存储');continue;}
      if(!localized.has(source)){
        sourceGuard();
        if(staticRef){
          resourceIndex||=await(await import('../local-resource-migration/canvas-load.mjs')).loadResourceIndex({fetchIndex:fetchImpl});sourceGuard();
          if(resourceIndex.state!=='ready')throw fail('media_unavailable','可信本地资源索引尚未就绪，请先导入实际素材');
          const saved=await importIndexedAsset(source,{index:resourceIndex.index,assets:localAssets,fetchImpl,signal,expectedKind:field==='image'?'image':asset.type,...(hashBytes?{hashBytes}:{}),beforePut:sourceGuard});sourceGuard();localized.set(source,saved);asset[field]=saved;continue;
        }
        const response=await fetchImpl(source,{signal});sourceGuard();if(!response.ok)throw fail('media_unavailable','画布素材读取失败');
        const blob=await response.blob();sourceGuard();if(!blob.size||blob.size>80*1024*1024||! /^(image|video|audio)\//.test(blob.type))throw fail('media_unavailable','画布内联素材无效或超过 80 MB');
        const saved=await localAssets.put(blob);sourceGuard();if(typeof saved!=='string'||!saved.startsWith('asset:'))throw fail('media_unavailable','画布素材未写入本地存储');localized.set(source,saved);
      }
      asset[field]=localized.get(source);
    }
    const next={...previous,id:previous?.id||createId(),scope:'personal',name,description:description.trim(),assets,createdAt:previous?.createdAt||now(),updatedAt:now()};
    id(next.id);if(!previous&&snapshot.items.some(s=>s.id===next.id))throw fail('subject_conflict','新主体 ID 已存在，未覆盖原主体');
    const nextVersion=await version(next);next.agentContentVersion=nextVersion;
    next.agentOperations=[...(previous?.agentOperations||[]),{operationId,action:'save',fingerprint,version:nextVersion,at:now()}];
    const items=snapshot.items.map(s=>s.id===next.id?next:s);if(!previous)items.push(next);
    await write(snapshot,items,signal,()=>{noImportOperation(operationId);sourceGuard();});
    return {operationId,action:'save',saved:true,applied:true,replayed:false,committedVersion:nextVersion,currentMatches:true,subject:summary(next,nextVersion,true)};
  }
  async function archive(input,{signal}={}){
    await library.ready();abort(signal);const operationId=id(input.operationId,'operationId'),subjectId=id(input.id),expectedVersion=expected(input.expectedVersion);reserve(operationId,'archive');noImportOperation(operationId);
    const request={action:'archive',operationId,id:subjectId,expectedVersion},fingerprint=await hash(canonical(request));abort(signal);
    const snapshot=load(),found=findOperation(snapshot.items,operationId);if(found)return replay(found,fingerprint);
    const subject=personal(snapshot.items,subjectId);if(await version(subject)!==expectedVersion)throw fail('version_conflict','主体内容版本已变化，请先重新读取');
    const next={...subject,deletedAt:now(),updatedAt:now()},nextVersion=await version(next);next.agentContentVersion=nextVersion;next.agentOperations=[...(subject.agentOperations||[]),{operationId,action:'archive',fingerprint,version:nextVersion,at:now()}];
    await write(snapshot,snapshot.items.map(s=>s.id===subjectId?next:s),signal,()=>noImportOperation(operationId));
    return {operationId,action:'archive',saved:true,applied:true,replayed:false,committedVersion:nextVersion,currentMatches:true,subject:summary(next,nextVersion,true)};
  }
  const matches=op=>!!op.nodeSnapshots&&op.nodeSnapshots.every(([node,snapshot])=>app.getState().nodes.includes(node)&&nodeContent(node)===snapshot);
  const importReceipt=op=>({operationId:op.request.operationId,subjectId:op.request.id,...(op.subjectName?{subjectName:readable(op.subjectName)}:{}),version:op.request.expectedVersion,nodeIds:op.nodes?.map(n=>n.id)||[],position:{...op.request.position},saved:op.saved===true,applied:!!op.nodes?.length,replayed:!!op.replayed,currentMatches:matches(op),status:op.saved?'succeeded':op.nodes?.length?'save_failed':'failed'});
  async function saveImport(op){
    if(typeof canvasStore?.save!=='function')throw fail('canvas_store_unavailable','画布存储不可用');
    const snapshots=op.nodes.map(node=>[node,nodeContent(node),node.provenance?.subjectImport?.outputHash]);
    for(const [node,snapshot,expectedHash]of snapshots)if(!app.getState().nodes.includes(node)||await hash(snapshot)!==expectedHash)throw fail('output_changed','已导入主体节点被删除或修改，不能自动重复导入');
    op.nodeSnapshots=snapshots;
    if(!matches(op)||snapshots.some(([node,,expectedHash])=>node.provenance?.subjectImport?.outputHash!==expectedHash))throw fail('output_changed','保存前主体节点已变化，未保存旧节点快照');
    try{const state=app.getState();if(await canvasStore.save({version:1,nodes:state.nodes,edges:state.edges})===false)throw Error('保存未完成');op.saved=true;return importReceipt(op);}
    catch(error){op.saved=false;throw fail('save_failed','主体节点已导入，但画布保存失败：'+error.message,{receipt:importReceipt(op),operationId:op.request.operationId,applied:true,nodeIds:op.nodes.map(n=>n.id)});}
  }
  async function applyToCanvas(input,{signal}={}){
    await library.ready();abort(signal);const operationId=id(input.operationId,'operationId'),subjectId=id(input.id),expectedVersion=expected(input.expectedVersion),position={x:input.position?.x,y:input.position?.y};
    reserve(operationId,'apply');if(findOperation(load().items,operationId))throw fail('operation_conflict','operationId 已绑定主体保存或归档操作');
    if(!Number.isFinite(position.x)||!Number.isFinite(position.y))throw fail('invalid_position','主体导入需要明确世界坐标');
    const request={action:'apply',operationId,id:subjectId,expectedVersion,position},fingerprint=await hash(canonical(request));abort(signal);
    let op=imports.get(operationId);if(op){if(op.fingerprint!==fingerprint)throw fail('operation_conflict','operationId 已绑定其他导入请求');if(op.pending)return op.pending;if(op.nodes){op.replayed=true;op.pending=saveImport(op).finally(()=>{delete op.pending;});return op.pending;}}
    op={request,fingerprint,saved:false};imports.set(operationId,op);
    op.pending=(async()=>{
      const prior=app.getState().nodes.filter(node=>node.provenance?.subjectImport?.operationId===operationId);
      if(prior.length){
        const count=prior[0].provenance.subjectImport.assetCount,indices=new Set();
        for(const node of prior){const info=node.provenance.subjectImport;if(info.fingerprint!==fingerprint||info.assetCount!==count||!Number.isInteger(info.assetIndex)||info.assetIndex<0||info.assetIndex>=count||indices.has(info.assetIndex))throw fail('operation_conflict','已有主体导入记录冲突');indices.add(info.assetIndex);}
        if(prior.length!==count)throw fail('partial_import','主体导入节点不完整，不会自动重复添加');op.nodes=prior.sort((a,b)=>a.provenance.subjectImport.assetIndex-b.provenance.subjectImport.assetIndex);op.subjectName=prior[0].provenance.subjectImport.subjectName;op.replayed=true;abort(signal);return saveImport(op);
      }
      const subject=personal(load().items,subjectId);if(await version(subject)!==expectedVersion)throw fail('version_conflict','主体内容版本已变化，请先重新读取');
      if(!subject.assets.length||subject.assets.length>100)throw fail('invalid_subject','主体需要包含 1–100 项素材才能导入');
      const original=content(subject),beforeCommit=()=>{abort(signal);if(content(personal(load().items,subjectId))!==original)throw fail('version_conflict','导入期间主体已修改或归档');};beforeCommit();
      op.subjectName=subject.name;
      const graph=await apply(structuredClone(subject),app,{signal,position,resolveUrl,beforeCommit,mapNode:async(node,index)=>({...node,provenance:{...node.provenance,subjectImport:{operationId,subjectId,subjectName:subject.name,version:expectedVersion,fingerprint,assetIndex:index,assetCount:subject.assets.length,outputHash:await hash(nodeContent(node))}}})});
      if(!Array.isArray(graph?.nodes)||graph.nodes.length!==subject.assets.length)throw fail('apply_failed','主体导入没有返回完整真实节点');op.nodes=graph.nodes;return saveImport(op);
    })().finally(()=>{delete op.pending;});return op.pending;
  }
  return {list,read,save,archive,apply:applyToCanvas};
}
