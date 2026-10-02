export function createThumbnailQueue({limit=2}={}) {
  let active=0,disposed=false;const waiting=[];
  const run=()=>{while(!disposed&&active<limit&&waiting.length){const item=waiting.shift();item.signal?.removeEventListener('abort',item.abort);if(item.signal?.aborted){item.reject(item.signal.reason);continue;}active++;Promise.resolve().then(item.execute).then(item.resolve,item.reject).finally(()=>{active--;run();});}};
  return {
    enqueue(execute,{signal}={}){if(disposed)return Promise.reject(Error('历史缩略图队列已关闭'));if(signal?.aborted)return Promise.reject(signal.reason);return new Promise((resolve,reject)=>{const item={execute,signal,resolve,reject};item.abort=()=>{const index=waiting.indexOf(item);if(index>=0){waiting.splice(index,1);reject(signal.reason);}};waiting.push(item);signal?.addEventListener('abort',item.abort,{once:true});run();});},
    dispose(){disposed=true;for(const item of waiting.splice(0)){item.signal?.removeEventListener('abort',item.abort);item.reject(new DOMException('历史面板已关闭','AbortError'));}},
    get active(){return active;},get pending(){return waiting.length;}
  };
}
// These URLs belong to history leases. Never revoke LocalAssets' shared URLs.
export function createThumbnailResources({load,createUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url)}) {
  const resources=new Map();let disposed=false;
  function retire(entry){entry.controller.abort(new DOMException('历史缩略图已释放','AbortError'));if(entry.url)revokeUrl(entry.url);entry.url=null;if(resources.get(entry.key)===entry)resources.delete(entry.key);}
  return {
    acquire(key,row){
      if(disposed)return {source:Promise.reject(Error('历史缩略图资源已关闭')),release(){}};
      let entry=resources.get(key);
      if(!entry){entry={key,refs:0,controller:new AbortController(),url:null};resources.set(key,entry);
        entry.promise=Promise.resolve().then(()=>load(row,entry.controller.signal)).then(value=>{if(entry.controller.signal.aborted||!entry.refs)return null;if(!value)return null;if(value.blob){entry.url=createUrl(value.blob);return entry.url;}return value.source || null;});entry.promise.catch(()=>{});
      }
      entry.refs++;let released=false;
      return {source:entry.promise,release(){if(released)return;released=true;if(--entry.refs===0)retire(entry);}};
    },
    dispose(){disposed=true;for(const entry of [...resources.values()])retire(entry);},
    get size(){return resources.size;}
  };
}
