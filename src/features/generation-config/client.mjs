const configPath = '/api/generation/config';

// Credentials are sent only to this process's same-origin endpoint. Neither
// drafts nor successful configuration responses are written to browser storage.
export async function saveLocalGenerationConfiguration(input, {fetchImpl = fetch, signal, token} = {}) {
  if (typeof token !== 'string' || !token) throw Error('本机配置会话未就绪，请刷新配置后重试');
  let body;
  if (input?.mode === 'environment') body = {mode: 'environment'};
  else {
    if (typeof input?.baseUrl !== 'string' || !input.baseUrl.trim()) throw Error('请输入任务网关地址');
    if (typeof input?.apiKey !== 'string' || input.apiKey.length > 8192) throw Error('API Key 格式无效');
    body = {baseUrl: input.baseUrl.trim(), apiKey: input.apiKey};
  }
  let response;
  try {
    response = await fetchImpl(configPath, {
      method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
      headers: {'Content-Type': 'application/json', 'X-Generation-Config-Token': token},
      body: JSON.stringify(body),
    });
  } catch {
    throw Error('未能确认配置是否保存，请先刷新本机配置；不要自动重复保存');
  }
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const messages = {
      configuration_invalid: '任务网关配置无效，请检查地址与 Key',
      configuration_destination_forbidden: '不能将原站或当前本机服务作为任务网关',
      configuration_origin_forbidden: '请从本机页面打开生成服务配置',
      configuration_csrf_forbidden: '本机配置会话已变化，请刷新配置后重试',
      configuration_capacity: '本次服务进程的配置版本已满，请保留任务记录并重启本机服务',
      configuration_too_large: '配置内容过长，请检查地址与 Key',
      recovery_unavailable: '当前服务未启用本地持久存储，不能保存任务网关配置',
    };
    throw Error(messages[value?.code] || '本机未接受配置，请检查地址、Key 与本机服务状态');
  }
  if (typeof value?.configured !== 'boolean' || !['session', 'environment'].includes(value.source)) throw Error('本机配置回执无效，请刷新配置核对');
  return value;
}

export function configurationBoundProvider(createProvider, {baseUrl, getConfigurationId, fetchImpl = fetch} = {}) {
  const make = configurationId => createProvider({
    baseUrl, cancelRemote: true, recoverable: true,
    fetchImpl: (url, options = {}) => fetchImpl(url, {
      ...options,
      ...(options.method === 'POST' && configurationId ? {headers: {...options.headers, 'X-Generation-Configuration-Id': configurationId}} : {}),
    }),
  });
  const recovery = make();
  return {...recovery, async generate(request, options = {}) {
    // Input preparation and dispatch must use the same configuration even when
    // another dialog changes the active provider while source bytes are read.
    try{return await make(getConfigurationId(options.signal)).generate(request, options);}
    catch(error){
      if(error.code==='unknown'&&error.recovery?.reason==='configuration_changed')throw Object.assign(Error('生成配置已变化，本次尚未提交；请刷新配置后重试'),{code:'configuration_required',providerDispatched:false});
      throw error;
    }
  }};
}
