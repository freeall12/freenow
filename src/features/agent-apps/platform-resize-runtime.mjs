import {captureResultSnapshot,assertResultSnapshot} from '../generation-results/plan.mjs';
import {platformResizeUri,platformResizeNodeId,validatePlatformResizeSpecs,buildPlatformResizeFormats,preparePlatformResize,validatePlatformResizeApply,platformResizePixels} from './platform-resize.mjs';
const failure = (code,message) => Object.assign(Error(message),{code});
const clone = value => structuredClone(value), same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const sourceMedia = node => node?.fullImage || node?.image;
const kind = 'platform-resize', maxBytes = 12*1024*1024, maxPixels = 32*1024*1024;
function deadline(signal) {
  const controller=new AbortController(),cancel=()=>controller.abort(signal?.reason || failure('cancelled','平台裁切已取消'));
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>controller.abort(failure('resize_timeout','平台裁切读取或保存超时')),30000);
  let reject;const aborted=new Promise((_,no)=>{reject=no;});aborted.catch(()=>{});
  const abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted)abort();
  return {signal:controller.signal,cancel:reason=>controller.abort(reason),wait:operation=>Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)throw controller.signal.reason;return operation();}),aborted]),close:()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',abort);}};
}
async function awaitSignal(operation,signal) {
  if(signal?.aborted)throw signal.reason;
  let reject;const interrupted=new Promise((_,no)=>{reject=no;}),abort=()=>reject(signal.reason);
  signal?.addEventListener('abort',abort,{once:true});
  try {return await Promise.race([Promise.resolve().then(operation),interrupted]);}
  finally {signal?.removeEventListener('abort',abort);}
}
async function defaultDecode(blob,{signal}={}) {
  if (typeof createImageBitmap==='function') {const image=await createImageBitmap(blob);if(signal?.aborted){image.close();throw signal.reason;}return image;}
  const url=URL.createObjectURL(blob),image=new Image();let abort;
  try {
    await new Promise((resolve,reject)=>{
      abort=()=>{image.onload=null;image.onerror=null;image.removeAttribute('src');reject(signal.reason);};
      image.onload=resolve;image.onerror=()=>reject(failure('image_decode_failed','源图无法解码'));
      if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});image.src=url;
    });
    if(signal?.aborted)throw signal.reason;
    return {width:image.naturalWidth,height:image.naturalHeight,image,close:()=>image.removeAttribute('src')};
  }finally {image.onload=null;image.onerror=null;signal?.removeEventListener('abort',abort);URL.revokeObjectURL(url);}

}
async function defaultRender(blob,rect,{signal,preview=false}={}) {
  const decoded=await defaultDecode(blob,{signal});
  try {
    const width=preview?Math.max(1,Math.round(rect.width*Math.min(1,960/Math.max(rect.width,rect.height)))):rect.width;
    const height=preview?Math.max(1,Math.round(rect.height*width/rect.width)):rect.height;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)throw failure('canvas_unavailable','浏览器无法裁切真实图片');ctx.drawImage(decoded.image||decoded,rect.x,rect.y,rect.width,rect.height,0,0,width,height);
    const output=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(failure('crop_encode_failed','裁切像素无法编码')),preview?'image/jpeg':'image/png',preview ? 0.8 : undefined));
    if(signal?.aborted)throw signal.reason;return {blob:output,width,height};
  }finally {decoded.close?.();}
}
async function dataUri(blob) {const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let at=0;at<bytes.length;at+=8192)text+=String.fromCharCode(...bytes.subarray(at,at+8192));return 'data:'+blob.type+';base64,'+btoa(text);}
// Source and all write adapters belong to the host. Iframe supplies only the
// official bounded geometry; no URL, provider request, or output IDs are accepted.
export function createPlatformResizeRuntime({app,localAssets,store,getProjectId,persistConversation,fetchImpl=(...args)=>fetch(...args),decodeImage=defaultDecode,renderCrop=defaultRender}={}) {
  for(const [name,fn] of Object.entries({'app.getState':app?.getState,'app.createConnected':app?.createConnected,'LocalAssets.put':localAssets?.put,'LocalAssets.url':localAssets?.url,'store.save':store?.save,getProjectId,persistConversation}))if(typeof fn!=='function')throw TypeError(name+' adapter is required');
  const preparations=new WeakMap(),operations=new Map(),state=()=>app.getState();
  function checkSnapshot(binding,isCurrent,signal) {
    if(signal?.aborted)throw signal.reason;
    if(isCurrent()!==true || getProjectId()!==binding.projectId)throw failure('stale_resize_app','平台裁切所属画布或会话已切换');
    assertResultSnapshot(binding.snapshot,state().nodes,state().edges||[]);return true;
  }
  async function readSource(binding,check,signal) {
    check();const node=state().nodes.find(n=>n.id===binding.snapshot.sourceNodeId);
    if(node?.type!=='image')throw failure('invalid_source','官方平台裁切仅支持真实图片；视频需走视频处理流程');
    let url=sourceMedia(node);if(typeof url!=='string'||!url)throw failure('invalid_source','图片节点没有真实媒体');
    if(url.startsWith('asset:'))url=await localAssets.url(url);check();
    let parsed;try{parsed=new URL(url,globalThis.document?.baseURI);}catch{throw failure('unsafe_source','真实图片地址无效');}
    if(parsed.username||parsed.password||!['http:','https:','blob:','data:'].includes(parsed.protocol)||parsed.protocol==='data:'&&!/^data:image\/(png|jpeg|webp);base64,/.test(url))throw failure('unsafe_source','真实图片地址协议或类型不受支持');
    const blob=await readBlob(url,check,signal);
    const hash=await digest(await blob.arrayBuffer());check();
    const image=await decodeImage(blob,{signal});try {check();if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>16384||image.height>16384||image.width*image.height>maxPixels)throw failure('source_over_limit','源图解码像素无效或超过32MP');return {blob,width:image.width,height:image.height,hash};}finally{image.close?.();}
  }
  async function readBlob(url,check,signal,expectedType) {
    const response=await fetchImpl(url,{signal});let reader,completed=false;
    try {
      check();if(!response?.ok)throw failure('source_read_failed','真实图片读取失败');
      const type=response.headers?.get('content-type')?.split(';')[0]?.trim(),length=response.headers?.get('content-length');
      if(!['image/png','image/jpeg','image/webp'].includes(type)||expectedType&&type!==expectedType||length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw failure('source_over_limit','图片类型无效或超过12MiB');
      let blob;
      if(response.body?.getReader){reader=response.body.getReader();const chunks=[];let total=0;while(true){const {done,value}=await awaitSignal(()=>reader.read(),signal);check();if(done){completed=true;break;}total+=value.byteLength;if(total>maxBytes)throw failure('source_over_limit','图片实际字节超过12MiB');chunks.push(value);}blob=new Blob(chunks,{type});}
      else throw failure('source_stream_unavailable','浏览器缺少有界图片读取能力');
      if(!blob.size||blob.size>maxBytes||blob.type!==type)throw failure('source_over_limit','图片为空、类型不符或超限');return blob;
    }finally {if(!completed){try{await (reader?.cancel?.()||response.body?.cancel?.());}catch{}}reader?.releaseLock?.();}
  }
  async function prepareAppArgs(args,{signal,isCurrent=()=>true}={}) {
    if(args.resource_uri!==platformResizeUri)return args;
    const data=args.data;if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['image_id','project_id','platforms','locale'].includes(k)))throw failure('invalid_input','平台适配只接受真实image_id与规格，预览和来源由宿主读取');
    const id=platformResizeNodeId(data.image_id),projectId=getProjectId();if(typeof projectId!=='string'||!projectId||data.project_id!==undefined&&data.project_id!==projectId)throw failure('invalid_project','平台裁切项目不符');
    const specs=validatePlatformResizeSpecs(data.platforms),binding={projectId,snapshot:captureResultSnapshot(state().nodes,state().edges||[],id)};
    const run=deadline(signal),check=()=>checkSnapshot(binding,isCurrent,run.signal);
    try {const actual=await run.wait(()=>readSource(binding,check,run.signal));check();const preview=await run.wait(()=>renderCrop(actual.blob,{x:0,y:0,width:actual.width,height:actual.height},{signal:run.signal,preview:true}));check();
      if(!(preview?.blob instanceof Blob)||preview.blob.size>590000)throw failure('preview_over_limit','真实图片预览超过宿主容量');
      const prepared={...clone(args),data:preparePlatformResize({node_ref:data.image_id,project_id:projectId,preview:{data_uri:await dataUri(preview.blob),width:actual.width,height:actual.height},platforms:buildPlatformResizeFormats(specs,actual.width,actual.height),locale:data.locale||'zh-CN',free:true})};check();
      preparations.set(prepared,{...clone(binding),source_sha256:actual.hash,width:actual.width,height:actual.height,response_sha256:await digest(new TextEncoder().encode(JSON.stringify(prepared.data)))});check();return prepared;
    }finally{run.close();}
  }
  function bindPreparedResult(result,args) {
    if(args.resource_uri!==platformResizeUri)return result;const binding=preparations.get(args);if(!binding)throw failure('invalid_source','缺少平台裁切原始来源绑定');checkSnapshot(binding,()=>true);return {...result,platformResizeSourceContext:clone(binding)};
  }
  function capture(response,{trace,chat,isCurrent}={}) {
    const binding=trace?.result?.platformResizeSourceContext;
    if(!binding||!trace?.id||!chat?.id||typeof isCurrent!=='function')throw failure('invalid_source','缺少平台裁切当前会话真实来源绑定');
    const lifetime=new AbortController();
    const data=preparePlatformResize(response),scope={projectId:binding.projectId,chatId:chat.id,traceId:trace.id};
    const guard=(signal)=>{if(lifetime.signal.aborted)throw lifetime.signal.reason;checkSnapshot(binding,isCurrent,signal);if(trace.result.response!==response||data.node_ref!=='node/'+binding.snapshot.sourceNodeId||data.project_id!==binding.projectId)throw failure('stale_resize_app','平台裁切卡片来源已变化');return true;};guard();
    async function current(signal,operationCurrent=()=>true) {guard(signal);if(operationCurrent()!==true)throw failure('stale_resize_action','平台裁切页面已重载或动作已过期');if(await digest(new TextEncoder().encode(JSON.stringify(response)))!==binding.response_sha256)throw failure('invalid_source','平台裁切预览或规格与原始来源绑定不符');guard(signal);if(operationCurrent()!==true)throw failure('stale_resize_action','平台裁切页面已重载或动作已过期');}
    async function apply(args,{callId,userAction,signal,isCurrent:operationCurrent=()=>true}={}) {
      if(userAction!==true)throw failure('user_action_required','裁切加入画布需要当前应用用户动作');
      if(typeof callId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(callId))throw failure('invalid_call_id','平台裁切调用标识无效');
      const request=validatePlatformResizeApply(args,data),fingerprint=JSON.stringify(request),key=JSON.stringify([scope,callId]);
      await current(signal,operationCurrent);const previous=operations.get(key);
      if(previous&&previous.fingerprint!==fingerprint)throw failure('operation_conflict','同一平台裁切调用不能更换规格');
      if(previous?.pending)return previous.pending;
      const scopeKey=JSON.stringify(scope),equivalent=[...operations.values()].find(item=>item.scopeKey===scopeKey&&item.fingerprint===fingerprint&&item.pending);
      if(equivalent){operations.set(key,equivalent);return equivalent.pending;}
      const op=previous||{fingerprint,scopeKey};if(operations.size>=1000&&!previous)throw failure('operation_limit','裁切调用过多，请重新打开会话');operations.set(key,op);
      const run=deadline(signal),abort=()=>run.cancel(lifetime.signal.reason);lifetime.signal.addEventListener('abort',abort,{once:true});op.pending=run.wait(()=>execute(run.signal)).finally(()=>{run.close();lifetime.signal.removeEventListener('abort',abort);delete op.pending;});return op.pending;
      async function execute(activeSignal) {
        const check=()=>{guard(activeSignal);if(operationCurrent()!==true)throw failure('stale_resize_action','平台裁切页面已重载或动作已过期');};await current(activeSignal,operationCurrent);
        const actual=await readSource(binding,check,activeSignal);check();if(actual.hash!==binding.source_sha256||actual.width!==binding.width||actual.height!==binding.height)throw failure('source_changed','实际源图字节或尺寸已变化，请重新打开平台适配');
        let nodes=state().nodes.filter(n=>n.provenance?.kind===kind&&same(n.provenance.scope,scope)&&n.provenance.fingerprint===fingerprint);
        const conflicting=state().nodes.some(n=>n.provenance?.kind===kind&&same(n.provenance.scope,scope)&&n.provenance.callId===callId&&n.provenance.fingerprint!==fingerprint);
        if(conflicting)throw failure('operation_conflict','已有裁切调用内容不同');
        if(op.nodeIds&&(!same(nodes.map(n=>n.id),op.nodeIds)))throw failure('output_changed','已生成的裁切图片被撤销或删除，不能自动重建');
        let receipt=trace.platformResizePlacements?.find(r=>r.fingerprint===fingerprint);
        if(receipt&&(!same(receipt.node_refs,nodes.map(n=>'node/'+n.id))||!same(receipt.output_sha256,nodes.map(n=>n.provenance.output_sha256))))throw failure('output_changed','已保存裁切结果被删除或修改，不能重复新增');
        const expected=request.crops.map(crop=>({crop,rect:platformResizePixels(crop,actual.width,actual.height,data.platforms.find(spec=>spec.platform===crop.platform).ratio_id)}));
        if(expected.reduce((sum,item)=>sum+item.rect.width*item.rect.height,0)>64*1024*1024)throw failure('output_over_limit','本批裁切超过64MP，请减少选中规格');
        if(!nodes.length) {
          const patches=[];
          for(const {crop,rect} of expected) {const rendered=await renderCrop(actual.blob,rect,{signal:activeSignal});check();
            if(!(rendered?.blob instanceof Blob)||rendered.blob.size<1||rendered.blob.size>maxBytes||rendered.blob.type!=='image/png'||rendered.width!==rect.width||rendered.height!==rect.height)throw failure('invalid_output','实际裁切编码或尺寸无效');
            const decoded=await decodeImage(rendered.blob,{signal:activeSignal});try {check();if(decoded.width!==rect.width||decoded.height!==rect.height)throw failure('invalid_output','裁切实际解码尺寸与取景不符');}finally{decoded.close?.();}
            const outputHash=await digest(await rendered.blob.arrayBuffer());check();const asset=await localAssets.put(rendered.blob);check();if(typeof asset!=='string'||!/^asset:[A-Za-z0-9_-]+$/.test(asset))throw failure('asset_save_failed','真实裁切未写入素材存储');
            const spec=data.platforms.find(p=>p.platform===crop.platform);
            patches.push({type:'image',title:spec.label_zh,image:asset,fullImage:asset,width:320,height:Math.max(1,Math.round(320*rect.height/rect.width)),pixelWidth:rect.width,pixelHeight:rect.height,provenance:{kind,scope:clone(scope),callId,fingerprint,source_sha256:actual.hash,crop:clone(crop),rect:clone(rect),outputMedia:asset,output_sha256:outputHash}});
          }
          check();const beforeInsert=await readSource(binding,check,activeSignal);if(beforeInsert.hash!==actual.hash)throw failure('source_changed','裁切期间源图实际字节已变化');check();nodes=app.createConnected(binding.snapshot.sourceNodeId,patches);
          if(!Array.isArray(nodes)||nodes.length!==request.crops.length||new Set(nodes.map(n=>n?.id)).size!==nodes.length)throw failure('apply_failed','本批真实裁切节点未完整加入画布');op.nodeIds=nodes.map(n=>n.id);
        } else if(nodes.length!==request.crops.length)throw failure('output_changed','已有裁切批次不完整，不能自动补建');
        const signatures=nodes.map(n=>JSON.stringify(n.provenance)),nodeIds=nodes.map(n=>n.id);op.nodeIds=nodeIds;
        function assertNodes() {nodes.forEach((node,index)=>{const p=node?.provenance;if(!node?.id||node.id!==nodeIds[index]||!state().nodes.includes(node)||node.type!=='image'||node.image!==p?.outputMedia||node.fullImage!==p?.outputMedia||JSON.stringify(p)!==signatures[index]||!/^asset:[A-Za-z0-9_-]+$/.test(p?.outputMedia)||!/^([0-9a-f]{64})$/.test(p?.output_sha256)||!same(p?.rect,expected[index].rect)||!same(p?.crop,request.crops[index])||!same(p?.scope,scope)||p?.fingerprint!==fingerprint||p?.source_sha256!==actual.hash||node.pixelWidth!==expected[index].rect.width||node.pixelHeight!==expected[index].rect.height)throw failure('output_changed','裁切节点已撤销、删除或媒体及来源被修改');});}
        async function verifyOutputBytes() {for(const node of nodes){const p=node.provenance,url=await localAssets.url(p.outputMedia);check();assertNodes();const blob=await readBlob(url,()=>{check();assertNodes();},activeSignal,'image/png');check();assertNodes();if(!blob.size||blob.size>maxBytes||blob.type!=='image/png'||await digest(await blob.arrayBuffer())!==p.output_sha256)throw failure('output_changed','裁切本地素材实际字节与回执不符');check();assertNodes();}}
        assertNodes();await verifyOutputBytes();check();assertNodes();
        if(await store.save(app.projectSnapshot?.()||state(),scope.projectId)===false)throw failure('save_failed','裁切已加入画布，但画布保存失败');assertNodes();await store.flush?.();check();assertNodes();
        // Re-read source bytes after graph commit; an asset can change while its
        // node identity remains fixed. Output pixels receive the same protection.
        const after=await readSource(binding,check,activeSignal);if(after.hash!==actual.hash)throw failure('source_changed','保存期间源图实际字节已变化');assertNodes();await verifyOutputBytes();
        receipt={callId,fingerprint,count:nodes.length,node_refs:nodes.map(n=>'node/'+n.id),source_sha256:actual.hash,crops:clone(request.crops),output_sha256:nodes.map(n=>n.provenance.output_sha256)};
        const previousRecords=trace.platformResizePlacements,next=[...(previousRecords||[]).filter(r=>r.fingerprint!==fingerprint),clone(receipt)];trace.platformResizePlacements=next;
        try {if(await persistConversation()===false)throw failure('conversation_save_failed','裁切节点已保存，但会话回执保存失败');await current(activeSignal,operationCurrent);assertNodes();await verifyOutputBytes();const final=await readSource(binding,check,activeSignal);if(final.hash!==actual.hash)throw failure('source_changed','会话保存期间源图实际字节已变化');assertNodes();}
        catch(error) {if(trace.platformResizePlacements===next){if(previousRecords===undefined)delete trace.platformResizePlacements;else trace.platformResizePlacements=previousRecords;}try{if(await persistConversation()===false)throw Error('补偿事务未提交');}catch{throw failure('conversation_rollback_failed','裁切节点保留，会话回执及补偿保存失败');}throw error;}
        check();assertNodes();return clone(receipt);
      }
    }
    return {scope,guard,dispose:()=>lifetime.abort(failure('cancelled','平台裁切应用已关闭')),isCurrent:()=>{try{return guard();}catch{return false;}},apply};
  }
  return {prepareAppArgs,bindPreparedResult,capture};
}
