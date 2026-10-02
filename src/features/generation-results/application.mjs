// Application retries reuse validated provider outputs. They never own provider
// dispatch, request preparation or task creation.
export function applicationReceipt(job) {
  return structuredClone({id:job.id,status:job.status,applied:!!job.applied,applying:!!job.applying,
    applicationStatus:job.applicationStatus||(job.applied?'applied':job.applicationError?'failed':job.applying?'applying':'pending'),
    applicationAttempts:job.applicationAttempts||0,resultIds:job.resultIds||[],
    ...(job.applicationError?{applicationError:job.applicationError}:{}),...(job.sceneResult?{sceneResult:job.sceneResult}:{})});
}
export function createApplicationRunner({getJob,apply,changed=()=>{}}) {
  const active=new Map();
  function run(id) {
    const job=getJob(id);
    if(!job) return Promise.reject(Error('生成任务不存在或页面会话已结束'));
    if(job.status!=='succeeded'||!Array.isArray(job.outputs)||!job.outputs.length) return Promise.reject(Error('只有已生成成功且保留结果的任务才能重试应用'));
    if(active.has(id))return active.get(id);
    if(job.applied)return Promise.resolve(applicationReceipt(job));
    job.applying=true;job.applicationStatus='applying';job.applicationError=null;job.applicationAttempts=(job.applicationAttempts||0)+1;
    // Record the promise before notifying subscribers so reentrant requests join
    // this attempt instead of applying the same output twice.
    const pending=Promise.resolve().then(()=>apply(job)).then(()=>{job.applied=true;job.applicationStatus='applied';},error=>{job.applied=false;job.applicationStatus='failed';job.applicationError='结果应用失败：'+(error.message||String(error));}).then(()=>{
      job.applying=false;active.delete(id);changed(job);return applicationReceipt(job);
    });
    active.set(id,pending);changed(job);return pending;
  }
  return {run};
}
