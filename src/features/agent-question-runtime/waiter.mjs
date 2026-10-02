const aborted=()=>new DOMException('Aborted','AbortError');

// One outstanding question per execution lane. UI disposal never settles it.
export function createQuestionWaiter({validate,onChange=()=>{},label='问题'}){
 let pending=null;
 return {
  get current(){return pending?.trace||null;},
  wait(trace,{signal}={}){
   if(signal?.aborted)return Promise.reject(aborted());
   if(pending)return Promise.reject(Error('已有'+label+'等待回答'));
   return new Promise((resolve,reject)=>{
    const entry={trace,resolve,reject,signal,abort:null};
    const clear=()=>{signal?.removeEventListener('abort',entry.abort);if(pending===entry)pending=null;};
    entry.abort=()=>{clear();reject(aborted());onChange(null);};
    entry.submit=result=>{const checked=validate(trace.args,result,trace.callId);clear();resolve(checked);onChange(null);return checked;};
    pending=entry;signal?.addEventListener('abort',entry.abort,{once:true});
    try{onChange(trace);}catch(error){clear();reject(error);}
   });
  },
  submit(trace,result){
   if(!pending||pending.trace!==trace||trace.status!=='waiting')throw Error('此'+label+'已结束，未提交回答');
   if(pending.signal?.aborted){pending.abort();throw aborted();}
   return pending.submit(result);
  },
  cancel(){pending?.abort();}
 };
}
