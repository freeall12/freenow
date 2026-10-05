/* Modern production shell with isolated synthetic search data; no model dispatch. */
(() => {
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'search-hover-1005k',prefix='qa-canvas-search:'+encodeURIComponent(session)+':',preferences=new Map(),open=indexedDB.open.bind(indexedDB),nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key),key:index=>[...preferences.keys()][index]??null,get length(){return preferences.size;}}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';
 // All store names, including lazily imported feature stores, stay in this QA session.
 indexedDB.open=(name,version)=>{name=String(name);if(!name.startsWith(prefix))name=prefix+name;return version===undefined?open(name):open(name,version);};
 const configuration={configured:false,missing:['QA 模型调用已禁用'],providers:{},routes:{},models:[],capabilities:{},configurationId:'isolated-canvas-search'};
 const audit={session,namespace:prefix,blockedExternal:0,blockedAPI:0,ready:false};
 window.fetch=(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,document.baseURI),method=(options.method||input?.method||'GET').toUpperCase();
  if(url.origin!==location.origin&&!['data:','blob:'].includes(url.protocol)){audit.blockedExternal++;return Promise.reject(Error('节点搜索 QA 禁止外部网络'));}
  if(url.pathname.startsWith('/api/')){
   if(method==='GET'&&url.pathname.endsWith('/config'))return Promise.resolve(Response.json(configuration));
   audit.blockedAPI++;return Promise.reject(Error('节点搜索 QA 禁止生产 API 和模型调用'));
  }
  return nativeFetch(input,options);
 };
 const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#1e2523"/><path d="M0 150L70 70L155 125L235 35L320 120V180H0Z" fill="#b88751"/><circle cx="70" cy="42" r="18" fill="#e6c590"/></svg>');
 const nodes=Array.from({length:500},(_,i)=>({id:'search-qa-'+i,type:i<450?'image':'text',title:(i<450?'性能镜头 ':'摄影脚本 ')+String(i+1).padStart(3,'0'),...(i<450?{image}:{content:'摄影机沿河移动，保留自然环境声。'}),x:52000.125+(i%20)*480.375,y:-3500.375+Math.floor(i/20)*320.125,width:435.25,height:250.125}));
 window.CanvasSearchPerformanceQA={session,namespace:prefix,data:{referenceWidth:889,referenceHeight:1011,nodes,edges:[]},audit:()=>({...audit}),get ready(){return audit.ready;}};
 document.addEventListener('DOMContentLoaded',()=>{
  const note=document.createElement('p');note.id='search-qa-status';note.setAttribute('role','status');note.style.cssText='position:fixed;right:16px;top:16px;z-index:20;color:#aaa;font-size:11px;pointer-events:none;margin:0';
  const count=window.CanvasApp?.getState().nodes.length??0;note.textContent='隔离搜索验收 · '+count+' 合成节点 · 正式上限30结果 · 模型禁用';document.body.append(note);audit.ready=!!window.CanvasApp;
 });
})();
