(() => {
 let database;const urls=new Map();
 let displayReady;
 async function consumableRef(value){
  const policy=await (displayReady||(displayReady=window.CanvasResourceDisplayReady||import('./src/features/local-resource-migration/display-media.mjs')));
  const safe=policy.displayMediaRef(value);
  if(!safe)throw Object.assign(Error('原站资源已停用，请重新导入本地资源'),{code:'original_service_blocked'});
  return safe;
 }
 function open(){return database||(database=new Promise((resolve,reject)=>{const req=indexedDB.open(window.LOCAL_ASSETS_DB_NAME||'tapnow-local-assets',1);req.onupgradeneeded=()=>req.result.createObjectStore('assets');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}));}
 async function put(blob){const db=await open(),id=crypto.randomUUID();await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put(blob,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('本地素材保存中断'));});return 'asset:'+id;}
 async function url(id){id=await consumableRef(id);if(!id.startsWith('asset:'))return id;if(urls.has(id))return urls.get(id);const db=await open();const blob=await new Promise((resolve,reject)=>{const req=db.transaction('assets').objectStore('assets').get(id.slice(6));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});if(!blob)throw Error('本地资源已丢失，请重新导入');const src=URL.createObjectURL(blob);urls.set(id,src);return src;}
 window.LocalAssets={put,url};
})();
