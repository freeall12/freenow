'use strict';
const {TaskService, httpProvider,normalizeApiBaseUrl} = require('../generation-api.js');
const {randomUUID}=require('node:crypto');
const {createDurableGenerationService}=require('./generation-durable.cjs');
const {createOpenAINativeProvider}=require('./generation-openai.cjs');

// Only the operator-selected task gateway receives requests. Browser payloads
// cannot choose a destination or supply server credentials.
function createGenerationGateway({baseUrl = '', apiKey = '', fetchImpl = fetch, now = Date.now, directory, protocol='tasks-v1',modelMap,client} = {}) {
  const native=protocol==='openai-native'?createOpenAINativeProvider({baseUrl,apiKey,modelMap,client,fetchImpl}):null;
  const invalidProtocol=!['tasks-v1','openai-native'].includes(protocol);
  let invalidEndpoint=false;
  if(protocol==='tasks-v1'&&baseUrl){try{baseUrl=normalizeApiBaseUrl(baseUrl);}catch{invalidEndpoint=true;}}
  const prepareRequest = async request => {
    if(request.kind==='video.depth'){const {prepareDepthTaskRequest}=await import('../src/features/agent-workflows/depth-video.mjs');return prepareDepthTaskRequest(request);}
    if (request.kind !== 'video.generate') return request;
    // Enforce the same draft/final wire contract for direct HTTP clients. The
    // browser owns graph validation; the gateway never guesses an alternate job.
    const {prepareVideoRequest} = await import('../src/features/video-generation/settings.mjs');
    return prepareVideoRequest(request);
  };
  const service = directory ? createDurableGenerationService({directory,baseUrl:native||invalidProtocol||invalidEndpoint?'':baseUrl,apiKey:invalidProtocol||invalidEndpoint?'':apiKey,fetchImpl,provider:native,now,prepareRequest}) : new TaskService({prepareRequest:async request=>{const prepared=await prepareRequest(request);if(native?.configured)native.prepare(prepared);return prepared;}});
  const configured=invalidProtocol||invalidEndpoint?false:native?native.configured:!!baseUrl&&!!apiKey;
  const configuration=native?native.metadata:{configured,protocol,missing:[...(!baseUrl?['GENERATION_API_BASE_URL']:[]),...(!apiKey?['GENERATION_API_KEY']:[])],configurationError:invalidProtocol||invalidEndpoint?'configuration_invalid':null,capabilities:{kinds:[],references:'gateway-defined',remoteRecovery:'gateway-defined',remoteCancellation:'gateway-defined',verified:'local-contract-only'}};
  const ready=service.ready||Promise.resolve();
  ready.catch(()=>{});
  if(!directory&&native&&configured)service.setProvider(native);
  else if (!directory && configured) service.setProvider(httpProvider({baseUrl, apiKey, fetchImpl, cancelRemote: true}));
  const terminal = new Set(['succeeded', 'failed', 'cancelled', 'configuration_required']);
  function prune() {
    if(directory)return;
    for (const [id, job] of service.jobs) if (terminal.has(job.status) && now() - job.createdAt > 3600000) service.jobs.delete(id);
  }
  function publicJob(job,{includeRequest=false}={}) {
    return {id: job.id, status: job.status, progress: job.progress, createdAt: job.createdAt,
      ...(job.outputs ? {outputs: job.outputs} : {}),
      ...(directory ? {...(includeRequest?{request:job.request}:{}),code:job.code,recovery:{...job.recovery,pollable:!!job.providerTaskId,submissionState:job.submissionState}} : {}),
      ...(job.cancellation ? {cancellation: job.cancellation} : {}),
      ...(job.error ? {error: job.status === 'unknown' ? '生成状态尚未确认，请查询恢复；不会自动重新生成' : job.status === 'configuration_required' ? '请检查服务端生成 API 协议、地址、Key 与真实模型映射后重启服务' : job.code==='request_preparation_failed'?'当前生成参数或操作不受适配器支持，尚未提交模型':'生成服务请求失败，请检查供应商配置或重试'} : {})};
  }
  return {
    configured,ready,close:()=>service.close?.(),
    async handle(req, res, pathname, {json, body}) {
      await ready;
      prune();
      if (pathname === '/api/generation/config' && req.method === 'GET') return json(res, 200, {...configuration,recovery:!!directory});
      if (pathname === '/api/generation/tasks' && req.method === 'POST') {
        const input = await body(req);
        if (typeof input.kind !== 'string' || !/^(image|video|audio|text|world|studio|model|panorama)\.[a-z][a-zA-Z.\-]*$/.test(input.kind) || (input.inputs !== undefined && !Array.isArray(input.inputs)) || (input.parameters !== undefined && (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters)))) return json(res, 400, {error: '生成任务参数无效'});
        if (!directory && service.jobs.size >= 500) return json(res, 429, {error: '任务记录已满，请稍后重试'});
        const job = directory ? await service.submit(input,{idempotencyKey:req.headers?.['idempotency-key']||randomUUID()}) : service.submit(input);
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
