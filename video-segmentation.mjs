// Production transport is same-origin; provider keys remain on the local server.
let provider=null,serverConfigured=false;
const configurationError=()=>Object.assign(Error('视频分割尚未配置或不可用；请在本地服务环境配置 API 并重启服务，然后刷新连接状态'),{code:'configuration_required'});
export const isConfigured=()=>provider===localProvider?serverConfigured:!!provider;
export function setProvider(next){if(next&&typeof next.segment!=='function')throw Error('分割服务需要 segment(request, context)');provider=next;}
export function httpProvider({fetchImpl=fetch,baseUrl,apiKey}={}){
 if(baseUrl!==undefined||apiKey!==undefined)throw Error('分割地址与 Key 请配置在本地服务环境，浏览器仅连接本机服务');
 return {async segment(request,{signal,onProgress=()=>{}}={}){
  onProgress(0);
  let response,result;
  try{response=await fetchImpl('/api/video-segmentation/segment',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal});result=await response.json();}
  catch{if(signal?.aborted)throw new DOMException('识别已取消；外部服务是否停止尚未确认','AbortError');throw Object.assign(Error('本机视频分割回执未确认；未自动重试'),{code:'segmentation_unknown'});}
  if(!response.ok){if(result?.code==='configuration_required')serverConfigured=false;throw Object.assign(Error(result?.error||'本机视频分割请求失败'),{code:result?.code||'segmentation_failed'});}
  if(result?.rleUrl)throw Error('本机分割服务未返回内联蒙层，请检查服务版本');
  if(signal?.aborted)throw new DOMException('识别已取消；外部服务是否停止尚未确认','AbortError');
  onProgress(100);return result;
 }};
}
const localProvider=httpProvider();
export async function refreshConfiguration({signal}={}){
 try{
  const response=await fetch('/api/video-segmentation/config',{signal,redirect:'error'});
  if(!response.ok)throw Error();
  const value=await response.json();if(!value||typeof value.configured!=='boolean')throw Error();serverConfigured=value.configured;return value;
 }catch(error){serverConfigured=false;if(error?.name==='AbortError')throw error;throw Object.assign(Error('无法读取本机分割配置，请检查本地服务是否正在运行'),{code:'configuration_required'});}
}
export async function availability({signal}={}){
 if(signal?.aborted)throw new DOMException('已取消','AbortError');
 if(!provider)throw configurationError();
 if(provider===localProvider){const value=await refreshConfiguration({signal});if(!value.configured)throw configurationError();}
 return true;
}
export async function segment(request,{signal,onProgress=()=>{}}={}){
 if(!provider)throw configurationError();
 if(signal?.aborted)throw new DOMException('已取消','AbortError');
 const selectedProvider=provider;let abort;const cancelled=new Promise((_,reject)=>{abort=()=>reject(new DOMException('识别已取消；外部服务是否停止尚未确认','AbortError'));signal?.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([Promise.resolve().then(()=>{if(signal?.aborted)throw new DOMException('已取消','AbortError');return selectedProvider.segment(request,{signal,onProgress});}),cancelled]);}finally{signal?.removeEventListener('abort',abort);}
}
export function configure({returnFocus=document.activeElement}={}){
 const d=document.createElement('dialog'),controller=new AbortController();d.className='api-dialog';const title=document.createElement('h2');title.textContent='本机视频分割服务';
 const guide=document.createElement('p');guide.textContent='在本地服务环境设置 VIDEO_SEGMENTATION_API_BASE_URL；需要认证时再设置 VIDEO_SEGMENTATION_API_KEY，然后重启服务。地址和 Key 保留在服务端。';
 const status=document.createElement('p');status.setAttribute('role','status');const refresh=document.createElement('button'),cancel=document.createElement('button');refresh.textContent='刷新连接状态';cancel.textContent='关闭';
 refresh.onclick=async()=>{refresh.disabled=true;status.textContent='正在读取本机配置…';try{const value=await refreshConfiguration({signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(!d.isConnected||controller.signal.aborted)return;if(value.configured){setProvider(localProvider);status.textContent='本机服务已配置；实际识别需点击编辑器的确认按钮，模型能力尚未验证。';}else status.textContent=value.configurationError?'本机配置无效，请检查分割地址与 Key 后重启服务':'尚未配置分割服务地址，请设置环境变量后重启服务';}catch(e){if(d.isConnected)status.textContent=e.message;}finally{refresh.disabled=false;}};
 cancel.onclick=()=>d.close();d.append(title,guide,status,cancel,refresh);document.body.append(d);d.onclose=()=>{controller.abort();d.remove();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});};d.showModal();refresh.click();return d;
}
if(typeof window!=='undefined'){setProvider(localProvider);window.VideoSegmentationAPI={setProvider,isConfigured,configure,refreshConfiguration};}
