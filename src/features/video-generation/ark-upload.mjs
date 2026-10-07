import {resolveProviderConfiguration,requestModelAlias} from '../node-composer/provider-configuration.mjs';
export function arkVideoPublication(metadata,request){
 const selected=resolveProviderConfiguration(metadata,request),alias=requestModelAlias(request),entries=selected?.capabilities?.videoUpload;
 const profile=entries&&Object.hasOwn(entries,alias)?entries[alias]:null;
 const enabled=selected?.configured===true&&profile?.transport==='fal-public-https'&&profile.publication==='public'&&profile.mimeTypes?.length===1&&profile.mimeTypes[0]==='video/mp4'&&profile.maxBytes===32*1024*1024;
 return {enabled,profile:enabled?profile:null,hint:enabled?'本地 MP4 将先发布至 fal 公网 HTTPS，再交给 Ark；需要独立 fal Key，限 32 MiB、24–30 FPS。':''};
}
export function arkLocalVideo(value,baseUrl=globalThis.document?.baseURI){
 if(typeof value==='string'&&/^asset:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))return true;
 try{const u=new URL(value,baseUrl),h=u.hostname.toLowerCase().replace(/\.+$/,'');if(u.username||u.password)return false;
  if(u.protocol==='data:')return /^data:video\/mp4;base64,/.test(value);
  if(u.protocol==='blob:')return !baseUrl||u.origin===new URL(baseUrl).origin;
  return ['http:','https:'].includes(u.protocol)&&!!baseUrl&&u.origin===new URL(baseUrl).origin&&(['localhost','127.0.0.1','[::1]'].includes(h));
 }catch{return false;}
}
export function arkPublicVideo(value){
 if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f\\]/.test(value)||value.includes('#'))return false;
 let u;try{u=new URL(value);}catch{return false;}const h=u.hostname.toLowerCase().replace(/\.+$/,'');
 const blocked=['tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'];
 if(u.protocol!=='https:'||u.username||u.password||!h||h.includes(':')||h==='localhost'||['.localhost','.local','.internal'].some(suffix=>h.endsWith(suffix))||blocked.some(domain=>h===domain||h.endsWith('.'+domain)))return false;
 if(/^\d+\.\d+\.\d+\.\d+$/.test(h)){const [a,b,c]=h.split('.').map(Number);if(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)return false;}
 return true;
}
export function assertArkVideoPublication(metadata,request,{baseUrl=globalThis.document?.baseURI}={}){
 const selected=resolveProviderConfiguration(metadata,request);if(selected?.protocol!=='ark-native')return;
 const publication=arkVideoPublication(metadata,request);
 for(const input of request.inputs??[]){if(input.type!=='video')continue;let u;try{u=new URL(input.url,baseUrl);}catch{throw Error('Ark 视频参考没有有效地址');}
  const local=arkLocalVideo(input.url,baseUrl);
  if(local&&!publication.enabled)throw Object.assign(Error('Ark 本地视频需要明确配置 videoUploadProvider 与独立 fal Key；仅 Ark Key 不足以发布素材。'),{code:'configuration_required',providerDispatched:false});
  if(!local&&!arkPublicVideo(input.url))throw Error('Ark 只接收已导入的本地 MP4 或独立公网 HTTPS 视频');
 }
}
