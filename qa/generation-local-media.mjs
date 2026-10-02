import {validateResultMedia} from '../src/features/generation-results/validate-media.mjs';
const byId=id=>document.getElementById(id),storageKey='qa:generation-local-media:'+location.origin;
let remembered;try{remembered=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
let taskId=remembered?.id||null,busy=false,manualRecovery=false,current=remembered?.snapshot,renderRevision=0;
const eventRows=[];
async function refreshCounters(){const response=await fetch('/api/fixture/state');if(!response.ok)throw Error('无法读取验收计数');const state=await response.json();byId('source-kind').textContent=state.sourceKind||'显式本机 PNG（当前运行 fixture），非模型结果';byId('task-posts').textContent=state.taskPostCount;byId('provider-posts').textContent=state.providerPostCount;byId('attempts').textContent=state.localizationAttempts;}
const service=new GenerationCore.TaskService();
service.setProvider(GenerationCore.httpProvider({baseUrl:location.origin+'/api/generation',recoverable:true,pollInterval:200,fetchImpl:(url,options={})=>fetch(url,{...options,headers:{...options.headers,...(manualRecovery&&options.method!=='POST'?{'X-Fixture-Recover-Original':'1'}:{})}})}));
function controls(){byId('submit').disabled=busy||!!taskId;byId('recover').disabled=busy||!taskId;}
function remember(job){const snapshot=Object.fromEntries(['id','status','providerStatus','localization','error','outputs','recovery'].filter(key=>job[key]!==undefined).map(key=>[key,job[key]]));localStorage.setItem(storageKey,JSON.stringify({id:taskId,snapshot}));}
async function display(job){
 current=job;const revision=++renderRevision;byId('task-id').textContent=taskId||'尚未提交';byId('status').textContent=job.status;byId('provider-status').textContent=job.providerStatus||'—';byId('localization').textContent=JSON.stringify(job.localization||{},null,2);byId('error').textContent=job.error||'';
 eventRows.push(job.status+' / '+(job.localization?.state||'—'));byId('events').textContent=eventRows.join('\n');remember(job);controls();
 if(job.status==='succeeded'){
  try{const output=job.outputs[0];await validateResultMedia(output);if(revision!==renderRevision)return;byId('image').src=output.fullImage||output.image||output.url;byId('media-url').textContent=byId('image').getAttribute('src');byId('dimensions').textContent=output.width+' × '+output.height;byId('result').hidden=false;byId('message').textContent='原任务媒体已在本机保存并实际解码；检查两项 POST 数量仍为 1。';}
  catch(error){byId('error').textContent='媒体校验失败：'+error.message;}
 }else if(job.status==='unknown'&&job.providerStatus==='succeeded'){byId('message').textContent='生成已完成，素材保存失败。点击“只取回原任务”，使用 GET 保存原结果。';}
 await refreshCounters();
}
service.subscribe(job=>{void display(job).catch(error=>{byId('error').textContent=error.message;});});
byId('submit').onclick=()=>{
 if(taskId||busy)return;byId('error').textContent='';const job=service.submit({kind:'image.generate',prompt:'固定本地 PNG，非 AI 生成',parameters:{model:'fixture-local-image'}});taskId=job.id;remember(job);byId('task-id').textContent=taskId;controls();
};
byId('recover').onclick=async()=>{
 if(busy||!taskId)return;busy=true;manualRecovery=true;controls();byId('error').textContent='';byId('message').textContent='正在通过 GET 取回原任务素材…';
 try{const job=await service.recover(taskId);await display(job);}catch(error){byId('error').textContent=error.message;}finally{busy=false;manualRecovery=false;controls();await refreshCounters();}
};
controls();if(current){byId('message').textContent='已从本机浏览器记录恢复原任务标识；可只取回原任务。';await display(current);}else await refreshCounters();
