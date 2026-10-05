(()=>{
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'manual';
 if(!/^[A-Za-z0-9_-]{1,80}$/.test(session))throw Error('History long-list QA session 无效');
 const namespace='qa-history-long-list:'+session+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key),clear:()=>preferences.clear(),key:index=>[...preferences.keys()][index]??null,get length(){return preferences.size;}}});
 window.CANVAS_DB_NAME=namespace+'canvas';window.LOCAL_ASSETS_DB_NAME=namespace+'assets';preferences.set('tapnow-playlist-intro-hidden','true');
 const seed={referenceWidth:1400,referenceHeight:900,nodes:[],edges:[]};Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
 const state=window.HistoryLongListFixture={session,namespace,synthetic:true,externalAttempts:[],blockedAPIs:[],errors:[],created:[],revoked:[],shared:[]};
 const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const source=create(blob);state.created.push({source,bytes:blob.size,mime:blob.type});return source;};URL.revokeObjectURL=source=>{state.revoked.push(source);revoke(source);};
 function allowed(input){const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){state.externalAttempts.push(url.hostname);throw Error('History long-list QA 禁止外部请求');}return url;}
 window.fetch=async(input,options={})=>{const url=allowed(input);if(['/api/generation/config','/api/agent/config'].includes(url.pathname))return Response.json({configured:false,protocol:'routed',providers:{},routes:{},missing:[],configurationError:null,capabilities:{kinds:[]}});if(url.pathname==='/api'||url.pathname.startsWith('/api/')){state.blockedAPIs.push(url.pathname);throw Error('History long-list QA 禁止模型及其他 API');}return nativeFetch(input,options);};
 const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,input,...rest){const url=allowed(input);if(url.pathname==='/api'||url.pathname.startsWith('/api/'))throw Error('History long-list QA 禁止其他 API');return open.call(this,method,input,...rest);};
 for(const name of ['WebSocket','EventSource'])window[name]=class{constructor(input){allowed(input);throw Error('History long-list QA 禁止服务连接');}};
 navigator.sendBeacon=input=>{allowed(input);throw Error('History long-list QA 禁止服务请求');};
 window.addEventListener('error',event=>state.errors.push(event.message));window.addEventListener('unhandledrejection',event=>state.errors.push(String(event.reason?.message||event.reason)));
})();
