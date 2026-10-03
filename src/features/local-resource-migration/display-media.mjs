import {isOriginalServiceHost} from './origin-policy.mjs';

// Inspect references without fetching or rewriting the retained source record.
export function isOriginalMediaRef(value,{baseUrl=globalThis.location?.href||'http://localhost/'}={}){
 if(typeof value!=='string'||!value.trim())return false;
 try{const url=new URL(value,baseUrl);return ['http:','https:'].includes(url.protocol)&&isOriginalServiceHost(url.hostname);}catch{return false;}
}
export function displayMediaRef(value){return typeof value==='string'&&!isOriginalMediaRef(value)?value:'';}
// Classic scripts can render local media while the shared module is loading.
export function fallbackDisplayMediaRef(value){return typeof value==='string'&&!/^(?:\s*https?:|\s*[\/\\]{2})/i.test(value)?value:'';}
export function nodeHasPendingOriginalMedia(node){return ['image','fullImage','video','audio','poster','thumbnail'].some(key=>isOriginalMediaRef(node?.[key]));}
export const pendingImportMessage='原站媒体待导入本地；旧引用已保留。请重新导入本地素材后替换。';
