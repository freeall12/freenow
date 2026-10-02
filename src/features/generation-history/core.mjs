import {receipt, outputSnapshot, listRows} from './model.mjs';
export function createHistory({projectId,store,archive,lookup,changed = () => {}}) {
  const key = 'agent-generation-history:' + projectId;
  let state = {version:1,projectId,receipts:[],rows:[]}, latest = Promise.resolve(), error = null, ready = false, pending = 0;
  const listeners = new Set(), transient = new Map();
  const transientLoss = () => state.rows.find(row=>row.archiveStatus==='failed' && !row.source && !state.receipts.find(entry=>entry.taskId===row.taskId)?.recoverable);
  const emit = () => { changed(); for (const listener of listeners) listener(); };
  const merge = remote => {
    if (!remote) return;
    if (remote.projectId !== projectId) throw Error('生成历史项目标识不匹配');
    for (const field of ['rows','receipts']) { const id = field === 'rows' ? 'id' : 'taskId', merged = new Map((remote[field] || []).map(row => [row[id],row]));
      for (const row of state[field]) { const prior = merged.get(row[id]); if (field==='rows' && prior?.archiveStatus==='ready' && row.archiveStatus!=='ready') continue; if (!prior || (row.updatedAt || '') >= (prior.updatedAt || '')) merged.set(row[id],row); }
      state[field] = [...merged.values()]; }
  };
  async function save() {
    for (let attempt=0;attempt<3;attempt++) {
      try { await store.writeRecord(key,structuredClone(state)); error = null; emit(); return; }
      catch (failure) { if (failure.name !== 'AgentConversationConflictError' || attempt === 2) { error = failure; emit(); throw failure; } merge(await store.readRecord(key)); }
    }
  }
  function enqueue(operation) { pending++; latest = latest.catch(() => {}).then(operation).finally(()=>{pending--;emit();}); latest.catch(() => {}); return latest; }
  function upsert(field,id,value) { const rows = state[field], key = field === 'rows' ? 'id' : 'taskId', index = rows.findIndex(row => row[key] === id); if (index < 0) rows.push(value); else rows[index] = {...rows[index],...value}; }
  const stamp = () => new Date().toISOString();
  async function observeNow(job) {
    const original = state.receipts.find(row => row.taskId === job.id);
    // Only a bound submission receipt may put a task into this project's history.
    if (!original) return;
    const application = {applied:job.applied === true, applicationError:typeof job.applicationError === 'string' ? job.applicationError : null, resultIds:Array.isArray(job.resultIds)?job.resultIds.filter(id=>typeof id==='string'):[]};
    upsert('receipts',job.id,{...original,...receipt(job,projectId,original.recoverable),status:job.status,remoteTaskId:job.remoteTaskId || original.remoteTaskId,application,updatedAt:stamp()});
    if (job.status !== 'succeeded' || !Array.isArray(job.outputs)) { await save(); return; }
    transient.set(job.id,job.outputs);
    const outputs = job.outputs.map(outputSnapshot);
    upsert('receipts',job.id,{...state.receipts.find(row=>row.taskId===job.id),outputs});
    for (let index=0;index<outputs.length;index++) {
      if (!outputs[index]) continue;
      const id = job.id + ':' + index, existing = state.rows.find(row=>row.id===id);
      const metadata = {...original,...receipt(job,projectId,original.recoverable)};
      const row = {...existing,id,taskId:job.id,outputIndex:index,projectId,type:outputs[index].type,kind:metadata.kind,sourceNodeId:metadata.sourceNodeId,createdAt:metadata.createdAt,
        prompt:metadata.prompt,parameters:metadata.parameters,model:metadata.parameters.model || metadata.parameters.modelId || '',title:outputs[index].title || metadata.prompt || metadata.kind,
        sourceFileId:outputs[index].sourceFileId || null,source:outputs[index].url || null,width:outputs[index].width,height:outputs[index].height,duration:outputs[index].duration,format:outputs[index].format,filename:outputs[index].filename,sourceRange:outputs[index].sourceRange,text:outputs[index].text,application,updatedAt:stamp()};
      if (existing?.archiveStatus === 'ready') { upsert('rows',id,row); continue; }
      upsert('rows',id,{...row,archiveStatus:'pending',archiveError:null});
    }
    // Commit the genuine provider outputs before asynchronous media IO, so a
    // refresh can retry archiving without submitting the model again.
    await save();
    for (const row of state.rows.filter(row=>row.taskId===job.id && row.archiveStatus !== 'ready')) {
      try { upsert('rows',row.id,{...row,...await archive(job.outputs[row.outputIndex],row),archiveStatus:'ready',archiveError:null,updatedAt:stamp()}); }
      catch (failure) { upsert('rows',row.id,{...row,archiveStatus:'failed',archiveError:failure.message,updatedAt:stamp()}); }
      await save();
    }
  }
  const api = {
    async ready() { if (ready) return; const value = await store.readRecord(key); if (value) { if (value.projectId !== projectId) throw Error('生成历史项目标识不匹配'); state={version:1,projectId,rows:value.rows || [],receipts:value.receipts || []}; } ready=true; emit(); },
    captureSubmission(job,{recoverable=false}={}) { return enqueue(async()=>{ const existing=state.receipts.find(row=>row.taskId===job.id); upsert('receipts',job.id,{...receipt(job,projectId,recoverable),...existing,updatedAt:stamp()}); await save(); }); },
    observe(job) { const snapshot={...job,request:structuredClone(job.request),outputs:job.outputs?.map(output=>({...output}))}; return enqueue(()=>observeNow(snapshot)); },
    retry(taskId) { return enqueue(async()=>{ const entry=state.receipts.find(row=>row.taskId===taskId); if (!entry) throw Error('未找到此项目的原任务');
      let outputs=transient.get(taskId)||entry.outputs;
      if ((!outputs || outputs.some(output=>output && !output.url)) && entry.recoverable) { const job=await lookup(entry); if (job.status !== 'succeeded') { await observeNow({...job,id:taskId,request:{kind:entry.kind,nodeId:entry.sourceNodeId,prompt:entry.prompt,parameters:entry.parameters},createdAt:entry.createdAt}); return; } outputs=job.outputs; }
      if (!outputs) { if (!entry.recoverable) throw Error('此适配器无法恢复原任务，请保留原页面'); const job=await lookup(entry); await observeNow({...job,id:taskId,request:{kind:entry.kind,nodeId:entry.sourceNodeId,prompt:entry.prompt,parameters:entry.parameters},createdAt:entry.createdAt}); return; }
      await observeNow({id:taskId,status:'succeeded',outputs,request:{kind:entry.kind,nodeId:entry.sourceNodeId,prompt:entry.prompt,parameters:entry.parameters},createdAt:entry.createdAt,...entry.application}); }); },
    async resume() { for (const entry of [...state.receipts]) if (entry.recoverable && (!['failed','cancelled','configuration_required'].includes(entry.status)) && (entry.status !== 'succeeded' || state.rows.some(row=>row.taskId===entry.taskId && row.archiveStatus !== 'ready'))) { try { await api.retry(entry.taskId); } catch(failure) { error=failure; emit(); } } },
    async flush() { let pending; do { pending=latest; await pending; } while(pending!==latest); if(error) throw error; if(state.rows.some(row=>row.archiveStatus==='pending'))throw Error('生成历史媒体仍在保存，请等待完成');const lost=transientLoss();if(lost)throw Error('此历史结果只保留在当前页面，离开会失去原始媒体。请先重试归档：'+lost.archiveError); },
    list(options) { return listRows(structuredClone(state.rows),options); },
    get(id) { const row=state.rows.find(row=>row.id===id);return row?structuredClone(row):null; },
    diagnostics() { return {pending,error:error?.message || null,transientLoss:transientLoss()?.id || null,receipts:structuredClone(state.receipts)}; },
    subscribe(listener) { listeners.add(listener); return ()=>listeners.delete(listener); },
    retrySave() { return enqueue(save); },
    markUnavailable(id,failure) { return enqueue(async()=>{const row=state.rows.find(row=>row.id===id);if(!row || row.archiveStatus!=='ready')return;upsert('rows',id,{...row,archiveStatus:'failed',archiveError:failure.message || '本地历史媒体无法读取',updatedAt:stamp()});await save();}); },
    updateThumbnail(id,mediaRef,patch) { return enqueue(async()=>{const row=state.rows.find(row=>row.id===id);if(!row || row.type!=='video' || row.archiveStatus!=='ready' || row.mediaRef!==mediaRef)return;if(patch.thumbnailRef && !patch.thumbnailRef.startsWith('asset:'))throw Error('历史缩略图必须保存到本地素材');const allowed=Object.fromEntries(['thumbnailRef','thumbnailStatus','thumbnailError'].filter(key=>patch[key]!==undefined).map(key=>[key,patch[key]]));upsert('rows',id,{...row,...allowed,updatedAt:stamp()});await save();}); }
  };
  return api;
}
