'use strict';
const {TaskService, httpProvider} = require('../generation-api.js');
const {randomUUID,createHash}=require('node:crypto');
const {createGenerationSessionConfiguration}=require('./generation-session-config.cjs');
const {endpoint:tasksEndpoint,protectGenerationFetch,assertIndependentMediaInputs}=require('./generation-endpoint-policy.cjs');
const path=require('node:path');
const {createGenerationMediaStore}=require('./generation-media-store.cjs');
const {createGenerationMediaHttp}=require('./generation-media-http.cjs');
const {createDurableGenerationService,checkedOutputs}=require('./generation-durable.cjs');
const {createOpenAINativeProvider}=require('./generation-openai.cjs');
const {createArkProvider}=require('./generation-ark.cjs');
const {createFalProvider}=require('./generation-fal.cjs');
const {createTripoProvider}=require('./generation-tripo.cjs');
const {createMiniMaxProvider}=require('./generation-minimax.cjs');
const {createElevenLabsProvider}=require('./generation-elevenlabs.cjs');
const {createMarbleProvider}=require('./generation-marble.cjs');
const {createMiniMaxMusicProvider}=require('./generation-minimax-music.cjs');
const {createFalVideoProvider}=require('./generation-fal-video.cjs');
const {createElevenLabsSoundProvider}=require('./generation-elevenlabs-sound.cjs');
const {createElevenLabsMusicProvider}=require('./generation-elevenlabs-music.cjs');
const {createOpenAIMaskedEditProvider}=require('./generation-openai-masked-edit.cjs');
const {createGenerationRouter}=require('./generation-router.cjs');
const {localVideoErrorMessage}=require('./video-analysis-errors.cjs');

// Task payloads cannot choose a destination or carry credentials. Local config
// writes select an immutable server transport before any task is persisted.
function createGenerationGateway({baseUrl = '', apiKey = '', fetchImpl = fetch, now = Date.now, directory, protocol='tasks-v1',modelMap,client,providers,routes,mediaDirectory,mediaStore:injectedMediaStore,mediaMaterializer:injectedMaterializer,localPort} = {}) {
  const routed=providers!==undefined||routes!==undefined;
  fetchImpl=protectGenerationFetch(fetchImpl);
  let invalidEndpoint=false;
  if(!routed){try{if(baseUrl)tasksEndpoint(baseUrl,{localPort});if(client?.baseURL)tasksEndpoint(client.baseURL,{localPort});}catch{invalidEndpoint=true;}}
  const native=routed?createGenerationRouter({providers,routes,fetchImpl,localPort}):invalidEndpoint?null:protocol==='openai-native'?createOpenAINativeProvider({baseUrl,apiKey,modelMap,client,fetchImpl}):protocol==='ark-native'?createArkProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='fal-native'?createFalProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='tripo-native'?createTripoProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='minimax-native'?createMiniMaxProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='elevenlabs-native'?createElevenLabsProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='marble-native'?createMarbleProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='minimax-music-native'?createMiniMaxMusicProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='fal-video-native'?createFalVideoProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='elevenlabs-sound-native'?createElevenLabsSoundProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='elevenlabs-music-native'?createElevenLabsMusicProvider({baseUrl,apiKey,modelMap,fetchImpl}):protocol==='openai-masked-edit-native'?createOpenAIMaskedEditProvider({baseUrl,apiKey,modelMap,client,fetchImpl}):null;
  const invalidProtocol=!routed&&!['tasks-v1','openai-native','ark-native','fal-native','tripo-native','minimax-native','elevenlabs-native','marble-native','minimax-music-native','fal-video-native','elevenlabs-sound-native','elevenlabs-music-native','openai-masked-edit-native'].includes(protocol);
  if(!routed&&protocol==='tasks-v1'&&baseUrl){try{baseUrl=tasksEndpoint(baseUrl,{localPort});}catch{invalidEndpoint=true;}}
  const prepareRequest = async (request,context={}) => {
    assertIndependentMediaInputs(request);
    const captured=context.provider===undefined?native:context.provider;
    const capturedProtocol=context.protocol||protocol;
    if(request.kind==='video.depth'){const {prepareDepthTaskRequest}=await import('../src/features/agent-workflows/depth-video.mjs');return assertIndependentMediaInputs(prepareDepthTaskRequest(request));}
    if (request.kind !== 'video.generate') return request;
    // Enforce the same draft/final wire contract for direct HTTP clients. The
    // browser owns graph validation; the gateway never guesses an alternate job.
    const {prepareVideoRequest} = await import('../src/features/video-generation/settings.mjs');
    const prepared=prepareVideoRequest(request);
    // UI display labels may normalize, but explicit wire identities must never
    // select a different paid provider as a side effect of that normalization.
    if(captured?.metadata?.protocol==='routed'&&[request.parameters?.modelId,request.parameters?.providerParameters?.model].some(alias=>alias!==undefined&&alias!==(prepared.parameters?.providerParameters?.model??prepared.parameters?.modelId??prepared.parameters?.model)))throw Object.assign(Error('生成模型标识不一致，未更换供应商或提交模型'),{code:'unsupported_generation'});
    // The catalog may suggest UI defaults, but an explicit API request must not
    // silently turn unsupported native options into a different paid generation.
    if(['ark-native','minimax-native'].includes(captured?.protocolFor?captured.protocolFor(prepared):capturedProtocol)&&!request.parameters?.draftVideoId){
      const before=request.parameters||{},after=prepared.parameters||{};
      const fields={ratio:'ratio',aspectRatio:'ratio',aspect:'ratio',quality:'quality',resolution:'quality',duration:'duration',audio:'audio',generateAudio:'audio',generateMode:'generateMode',videoMode:'videoMode',variant:'variant',mode:'mode'};
      const changed=Object.entries(fields).some(([input,output])=>before[input]!==undefined&&before[input]!==after[output]);
      const wireChanged=Object.entries(before.providerParameters||{}).some(([key,value])=>value!==after.providerParameters?.[key]);
      if(changed||wireChanged)throw Object.assign(Error('所选视频参数不受支持，未更换规格或提交模型'),{code:'unsupported_generation'});
    }
    return assertIndependentMediaInputs(prepared);
  };
  // The production server always supplies directory. Omitting it retains the
  // legacy nonpersistent adapter contract, which does not localize media.
  const mediaStore=directory?(injectedMediaStore||(!injectedMaterializer?createGenerationMediaStore({directory:mediaDirectory||path.join(path.dirname(directory),path.basename(directory)+'-media'),maxBytes:256*1024*1024}):null)):null;
  const mediaMaterializer=directory?(injectedMaterializer||require('./generation-media-materializer.cjs').createGenerationMediaMaterializer({store:mediaStore})):null;
  const configured=invalidProtocol||invalidEndpoint?false:native?native.configured:!!baseUrl&&!!apiKey;
  const configuration=native?native.metadata:{configured,protocol,missing:[...(!baseUrl?['GENERATION_API_BASE_URL']:[]),...(!apiKey?['GENERATION_API_KEY']:[])],configurationError:invalidProtocol||invalidEndpoint?'configuration_invalid':null,capabilities:{kinds:[],references:'gateway-defined',remoteRecovery:'gateway-defined',remoteCancellation:'gateway-defined',verified:'local-contract-only'}};
  const environment={provider:native,configured,fingerprint:native?native.fingerprint:baseUrl&&!invalidEndpoint&&!invalidProtocol?createHash('sha256').update(baseUrl).digest('hex'):null,metadata:configuration};
  const sessionConfiguration=directory?createGenerationSessionConfiguration({environment,fetchImpl,localPort}):null;
  const service = directory ? createDurableGenerationService({directory,mediaMaterializer,baseUrl:native||invalidProtocol||invalidEndpoint?'':baseUrl,apiKey:invalidProtocol||invalidEndpoint?'':apiKey,fetchImpl,provider:native,now,prepareRequest,providerRegistry:sessionConfiguration}) : new TaskService({prepareRequest:async request=>{const prepared=await prepareRequest(request);if(native?.configured)native.prepare(prepared);return prepared;}});
  const mediaHttp=mediaStore?createGenerationMediaHttp({store:mediaStore,ownsResource:service.ownsResource}):null;
  const ready=Promise.all([service.ready||Promise.resolve(),mediaStore?.ready||Promise.resolve()]);
  ready.catch(()=>{});
  if(!directory&&native&&configured)service.setProvider(native);
  else if (!directory && configured) service.setProvider(httpProvider({baseUrl, apiKey, fetchImpl, cancelRemote: true}));
  const terminal = new Set(['succeeded', 'failed', 'cancelled', 'configuration_required']);
  function prune() {
    if(directory)return;
    for (const [id, job] of service.jobs) if (terminal.has(job.status) && now() - job.createdAt > 3600000) service.jobs.delete(id);
  }
  function publicJob(job,{includeRequest=false}={}) {
    const mediaRecoveryError={media_source_refresh_unavailable:'生成已完成，素材链接已失效；原供应商任务不支持重新取回，未重新生成',media_source_provider_changed:'生成已完成；原供应商配置已改变，请恢复原配置后重新取回素材',media_source_configuration_required:'生成已完成；请配置原供应商后重新取回素材',media_source_identity_mismatch:'原供应商返回了其他任务，未接收结果；未重新生成',media_source_refresh_unconfirmed:'原供应商尚未确认素材取回结果；未重新生成',media_source_refresh_failed:'生成已完成，原任务素材查询失败；可重新取回，未重新生成'}[job.localization?.errorCode];
    const localError=job.request?.kind==='video.analyze'&&job.status==='failed'&&job.providerDispatched===false?localVideoErrorMessage(job.code):null;
    return {id: job.id, status: job.status, progress: job.progress, createdAt: job.createdAt,
      ...(job.outputs&&job.status==='succeeded' ? {outputs:directory?checkedOutputs(job.outputs,{localOnly:true}):job.outputs} : {}),
      ...(directory&&job.providerStatus?{providerStatus:job.providerStatus}:{}),
      ...(directory&&job.localization?{localization:{state:job.localization.state,revision:job.localization.revision,errorCode:job.localization.errorCode,retryable:job.localization.retryable}}:{}),
      ...(directory ? {...(includeRequest?{request:job.request}:{}),code:job.code,recovery:{...job.recovery,pollable:!!job.providerTaskId||job.providerStatus==='succeeded'&&!!job.providerResult,submissionState:job.submissionState}} : {}),
      ...(job.cancellation ? {cancellation: job.cancellation} : {}),
      ...(localError?{code:job.code,providerDispatched:false}:{}),
      ...(job.error ? {error: job.code==='media_localization_failed'?(mediaRecoveryError||'生成已完成，素材保存失败；请重新取回素材'):job.status === 'unknown' ? '生成状态尚未确认，请查询恢复；不会自动重新生成' : job.status === 'configuration_required' ? '请检查服务端生成 API 协议、地址、Key 与真实模型映射后重启服务' : localError|| (job.code==='request_preparation_failed'?'当前生成参数或操作不受适配器支持，尚未提交模型':'生成服务请求失败，请检查供应商配置或重试')} : {})};
  }
  return {
    get configured(){return sessionConfiguration?sessionConfiguration.metadata().configured:configured;},ready,close:async()=>{await service.close?.();await mediaHttp?.close();await mediaStore?.close();},
    async handle(req, res, pathname, {json, body}) {
      await ready;
      prune();
      const media=pathname.match(/^\/api\/generation\/media\/([^/]+)$/);
      if(media)return mediaHttp?mediaHttp.handle(req,res,media[1],{json}):json(res,404,{code:'media_not_found',error:'本地媒体不存在'});
      if (pathname === '/api/generation/config') {
        if(req.method==='GET')return json(res,200,{...(sessionConfiguration?sessionConfiguration.metadata():{...configuration,source:'environment'}),recovery:!!directory});
        if(req.method==='POST'){if(!sessionConfiguration)return json(res,409,{code:'recovery_unavailable',error:'当前网关未启用本机持久生成服务'});return sessionConfiguration.handle(req,res,{json:(res,status,value)=>json(res,status,status===200?{...value,recovery:true}:value)});}
        return json(res,405,{error:'Method not allowed'});
      }
      if (pathname === '/api/generation/tasks' && req.method === 'POST') {
        const input = await body(req);
        if (typeof input.kind !== 'string' || !/^(image|video|audio|text|world|studio|model|panorama)\.[a-z][a-zA-Z.\-]*$/.test(input.kind) || (input.inputs !== undefined && !Array.isArray(input.inputs)) || (input.parameters !== undefined && (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters)))) return json(res, 400, {error: '生成任务参数无效'});
        if (!directory && service.jobs.size >= 500) return json(res, 429, {error: '任务记录已满，请稍后重试'});
        let job;
        try{job=directory?await service.submit(input,{idempotencyKey:req.headers?.['idempotency-key']||randomUUID(),configurationId:req.headers?.['x-generation-configuration-id']}):service.submit(input);}
        catch(error){if(error.code==='configuration_changed')return json(res,409,{code:'configuration_changed',providerDispatched:false,error:'生成配置已变化，请刷新配置后重新确认提交；尚未提交供应商'});throw error;}
        return json(res, 202, publicJob(job));
      }
      const lookup=pathname.match(/^\/api\/generation\/tasks\/by-key\/([^/]+)$/);
      if(lookup){if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});if(!directory)return json(res,409,{code:'recovery_unavailable',error:'当前网关未启用持久恢复'});const job=await service.lookup(lookup[1]);return job?json(res,200,publicJob(job,{includeRequest:true})):json(res,404,{code:'task_not_found',error:'没有找到该提交记录；未重新生成'});}
      const match = pathname.match(/^\/api\/generation\/tasks\/([^/]+)$/);
      if (match) {
        if(!['GET','DELETE'].includes(req.method))return json(res,405,{error:'Method not allowed'});
        const job = directory ? (req.method==='DELETE'?await service.cancel(match[1]):await service.get(match[1])) : service.jobs.get(match[1]);
        if (!job) return json(res, 404, {error: '任务不存在或已过期',...(!directory && req.method === 'DELETE' ? {cancellation:service.cancel(match[1])} : {})});
        if (req.method === 'DELETE') {const cancellation=directory?job.cancellation:service.cancel(job.id);return json(res, 200, {...publicJob(job),cancellation});}
        else if (req.method !== 'GET') return json(res, 405, {error: 'Method not allowed'});
        return json(res, 200, publicJob(job));
      }
      return json(res, 404, {error: 'Unknown generation route'});
    },
  };
}
module.exports = {createGenerationGateway};
