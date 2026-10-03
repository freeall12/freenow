// QA-only database; it does not change product schemas or consume localStorage
// quota shared with the real canvas. Resolve saves only after transaction commit.
export function createTemplateQaChatStore({indexedDB=globalThis.indexedDB,name='tapnow-template-source-qa-chat-v2',label='模板验收'}={}){
 let database,work=Promise.resolve(),closed=false;
 function connect(){
  if(closed)throw Error(label+'会话存储已关闭');
  if(!database)database=new Promise((resolve,reject)=>{
   const request=indexedDB.open(name,1);
   request.onupgradeneeded=()=>request.result.createObjectStore('conversation');
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error||Error(label+'会话数据库不可用'));
   request.onblocked=()=>reject(Error(label+'会话数据库被其他页面占用'));
  }).catch(error=>{database=null;throw error;});
  return database;
 }
 async function transaction(mode,value){
  const db=await connect();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('conversation',mode),store=tx.objectStore('conversation'),request=mode==='readonly'?store.get('chat'):store.put(value,'chat');
   let result;request.onsuccess=()=>{result=request.result;};
   tx.oncomplete=()=>resolve(mode==='readonly'?result:true);
   tx.onerror=tx.onabort=()=>reject(tx.error||request.error||Error(label+'会话保存中断'));
  });
 }
 return {load:()=>transaction('readonly'),save(chat){const snapshot=structuredClone(chat);const next=work.catch(()=>{}).then(()=>transaction('readwrite',snapshot));work=next;return next;},close(){closed=true;void database?.then(db=>db.close()).catch(()=>{});}};
}
