(() => {
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'default',prefix='qa-library-roundtrip:'+encodeURIComponent(session)+':',preferences=new Map(),nativeLocks=navigator.locks;
 let writes=Promise.resolve(),database,libraryWriteAttempts=0;const capacity=new URLSearchParams(location.search).get('capacity')==='1';
 const ready=new Promise((resolve,reject)=>{
  const request=indexedDB.open(prefix+'preferences',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('records');
  request.onsuccess=()=>{database=request.result;const transaction=database.transaction('records','readonly'),cursor=transaction.objectStore('records').openCursor();cursor.onsuccess=()=>{const entry=cursor.result;if(entry){preferences.set(entry.key,entry.value);entry.continue();}};transaction.oncomplete=resolve;transaction.onerror=transaction.onabort=()=>reject(transaction.error);};
  request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('QA preferences数据库被旧页面阻塞'));
 });
 function persist(key,value){
  writes=writes.then(async()=>{await ready;await new Promise((resolve,reject)=>{const transaction=database.transaction('records','readwrite'),store=transaction.objectStore('records');value===null?store.delete(key):store.put(value,key);transaction.oncomplete=resolve;transaction.onerror=transaction.onabort=()=>reject(transaction.error||Error('QA preferences写入失败'));});});
  writes.catch(error=>console.error('QA preferences:',error));
 }
 const flush=async()=>{let pending;do{pending=writes;await pending;}while(pending!==writes);};
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem(key,value){if(capacity&&['tapnow-library','tapnow-folders'].includes(key)){libraryWriteAttempts++;throw new DOMException('QA localStorage quota exceeded','QuotaExceededError');}preferences.set(key,String(value));persist(key,String(value));},removeItem(key){preferences.delete(key);persist(key,null);},key:index=>[...preferences.keys()][index]??null,get length(){return preferences.size;}}});
 // Older QA preference consumers still use locks. Production CanvasLibrary
 // commits through its actual CanvasStore record transaction in the session DB.
 Object.defineProperty(navigator,'locks',{value:{request(name,options,callback){if(typeof options==='function'){callback=options;options=undefined;}const operation=async lock=>{const result=await callback(lock);await flush();return result;};return nativeLocks?.request?(options?nativeLocks.request(prefix+name,options,operation):nativeLocks.request(prefix+name,operation)):operation(null);}}});
 window.LibraryRoundtripQAStorage={ready,flush,namespace:prefix,get libraryWriteAttempts(){return libraryWriteAttempts;}};
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';window.TEMPLATE_DB_NAME=prefix+'templates';
 window.CANVAS_DATA={referenceWidth:889,referenceHeight:1011,nodes:[],edges:[]};
 window.addEventListener('pagehide',()=>database?.close());
})();
