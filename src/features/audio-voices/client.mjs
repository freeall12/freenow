const maxPreviewBytes=10*1024*1024;
const aborted=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('已取消','AbortError');};
const fail=(message,code)=>Object.assign(new Error(message),{code});
async function errorResponse(response){let body={};try{body=await response.json();}catch{}throw fail(body.error||'音色服务请求失败',body.code||'voice_catalog_failed');}
export function createVoiceProvider({fetcher=globalThis.fetch}={}){
 return {
  async listVoices({model='eleven_v3',signal,search='',cursor,pageSize=100}={}){
   aborted(signal);const query=new URLSearchParams({model,pageSize:String(pageSize)});if(search)query.set('search',search);if(cursor)query.set('cursor',cursor);
   const response=await fetcher('/api/generation/voices?'+query,{signal,credentials:'same-origin',redirect:'error',cache:'no-store'});if(!response.ok)await errorResponse(response);const body=await response.json();aborted(signal);
   if(body.configured!==true||!Array.isArray(body.voices))throw fail('音色目录返回格式无效','voice_catalog_invalid');
   const ids=new Set();const voices=body.voices.map(voice=>{if(typeof voice.id!=='string'||!voice.id.trim()||typeof voice.name!=='string'||!voice.name.trim()||ids.has(voice.id))throw fail('音色目录缺少稳定标识或存在重复','voice_catalog_invalid');ids.add(voice.id);const result={id:voice.id,name:voice.name,labels:voice.labels||{},category:voice.category,description:voice.description};if(voice.previewRef||voice.previewUrl)result.previewRef=voice.id;return result;});
   if(body.hasMore&&!body.nextCursor)throw fail('音色目录分页标识缺失','voice_catalog_invalid');return {...body,voices};
  },
  async previewVoice(voice,{model='eleven_v3',signal}={}){
   aborted(signal);if(!voice?.id)throw fail('音色标识缺失','voice_preview_invalid');const url='/api/generation/voices/'+encodeURIComponent(voice.id)+'/preview?'+new URLSearchParams({model});
   const response=await fetcher(url,{signal,credentials:'same-origin',redirect:'error',cache:'no-store'});if(!response.ok)await errorResponse(response);
   if(!/^audio\//i.test(response.headers.get('content-type')||''))throw fail('试听返回了非音频内容','voice_preview_invalid');if(Number(response.headers.get('content-length'))>maxPreviewBytes)throw fail('试听文件超过10MB','voice_preview_invalid');
   const blob=await response.blob();aborted(signal);if(!blob.size||blob.size>maxPreviewBytes)throw fail('试听为空或超过10MB','voice_preview_invalid');return blob;
  }
 };
}
