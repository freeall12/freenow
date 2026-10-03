import {prepareGenerationRequest} from '../../node-composer/generation-request.mjs';
import {prepareGenerationMediaRequest} from '../../node-composer/generation-media.mjs';
import {createWorkflowMediaResolver} from '../../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs} from '../../agent-workflows/media-transport.mjs';
import {subjectToken} from '../../subject-library/model.mjs';

const sourceFor=file=>new URL('./media/'+file+'.mp4',import.meta.url).href;
const loaded=new Map(),results=new Map(),buttons=[];
const tbody=document.querySelector('#cases'),payload=document.querySelector('#payload'),error=document.querySelector('#error');
let running=false;
const subject={id:'qa-text-subject',name:'合成文字主体',assets:[{id:'description',type:'text',text:'棕色外套，保持主体身份'}]};
const expectedDuration={'1-9':1.9,'2':2,'30-2':30.2,'30-25':30.25,'15-1':15.1,'15-15':15.15};
const cases=[
  {id:'empty',name:'空全能参考 → 文生视频',files:[],captured:1,mode:'TEXT_TO_VIDEO'},
  {id:'subject',name:'真实文字主体保留参考模式',files:[],captured:1,mode:'REFERENCE_TO_VIDEO',subject:true},
  {id:'wire-element',name:'wire-only 主体元素字段保留',files:[],captured:1,mode:'REFERENCE_TO_VIDEO',wireElement:true},
  {id:'below-min',name:'1.9 秒低于严格下界',files:['1-9'],captured:0,code:'video_reference_duration'},
  {id:'at-min',name:'2 秒下界可用',files:['2'],captured:1,mode:'REFERENCE_TO_VIDEO'},
  {id:'at-max',name:'30.2 秒上界容差可用',files:['30-2'],captured:1,mode:'REFERENCE_TO_VIDEO'},
  {id:'above-max',name:'30.25 秒超出上界',files:['30-25'],captured:0,code:'video_reference_duration'},
  {id:'at-total',name:'15.1 + 15.1 = 30.2 秒可用',files:['15-1','15-1'],captured:1,mode:'REFERENCE_TO_VIDEO'},
  {id:'above-total',name:'15.15 + 15.15 超出总时长',files:['15-15','15-15'],captured:0,code:'video_reference_duration'}
];

async function asset(file){
  if(!loaded.has(file))loaded.set(file,(async()=>{
    const response=await fetch(sourceFor(file),{redirect:'error'});
    if(!response.ok)throw Error('合成 MP4 读取失败：'+file);
    return window.LocalAssets.put(await response.blob());
  })());
  return loaded.get(file);
}

function summarize(request){
  if(!request)return null;
  return {kind:request.kind,prompt:request.prompt,inputs:request.inputs.map(({type,duration,durationMs,width,height,url,text})=>({type,duration,durationMs,width,height,...text?{text}:{},...url?{media:url.startsWith('data:')?'真实内联媒体，URL 长度 '+url.length:url}:{}})),parameters:{model:request.parameters.model,videoMode:request.parameters.videoMode,providerParameters:request.parameters.providerParameters,subjects:request.parameters.subjects,subjectPrompt:request.parameters.subjectPrompt}};
}

async function run(entry){
  const trace={metadataReads:0,transportPasses:0,adapterCaptured:0,decoded:[],capturedRequest:null};
  const resolver=createWorkflowMediaResolver({localAssets:window.LocalAssets,baseUrl:document.baseURI});
  const service=new window.GenerationCore.TaskService({
    prepareRequest:prepareGenerationRequest,
    prepareInputs:request=>prepareGenerationMediaRequest(request,{localAssets:window.LocalAssets,baseUrl:document.baseURI,
      resolveMedia:async(node,options)=>{trace.metadataReads++;const actual=await resolver(node,options);trace.decoded.push({duration:actual.duration,width:actual.width,height:actual.height});return actual;},
      transport:async(request,options)=>{trace.transportPasses++;return prepareWorkflowInputs(request,{...options,baseUrl:document.baseURI});}})
  });
  service.setProvider({isConfigured:()=>true,generate:async request=>{
    trace.adapterCaptured++;trace.capturedRequest=structuredClone(request);
    throw Object.assign(Error('合成诊断已捕获请求；未调用供应商，未生成结果'),{code:'qa_capture_only',providerDispatched:false});
  }});
  const inputs=await Promise.all(entry.files.map(async(file,index)=>({id:entry.id+'-video-'+index,type:'video',url:await asset(file)})));
  const request={kind:'video.generate',label:entry.name,prompt:entry.subject?subjectToken(subject)+'向镜头走来':'合成参考时长诊断',inputs,parameters:{model:'Seedance 2.5',mode:'全能参考',videoMode:'REFERENCE_TO_VIDEO',duration:5,count:1,...entry.subject?{subjects:[subject]}:{},...entry.wireElement?{providerParameters:{element_refs:[{element_id:'qa-existing-subject'}]}}:{}}};
  const finished=new Promise(resolve=>service.subscribe(job=>{if(!['queued','running'].includes(job.status))resolve(job);}));
  service.submit(request);const job=await finished;
  const mode=trace.capturedRequest?.parameters.providerParameters.modelType;
  const retained=entry.subject?trace.capturedRequest?.parameters.subjects?.[0]?.id===subject.id:entry.wireElement?trace.capturedRequest?.parameters.providerParameters.element_refs?.[0]?.element_id==='qa-existing-subject':true;
  const decodedMatches=trace.decoded.length===entry.files.length&&trace.decoded.every((value,index)=>Math.abs(value.duration-expectedDuration[entry.files[index]])<.000001&&value.width===64&&value.height===48);
  const matched=trace.adapterCaptured===entry.captured&&(entry.mode?mode===entry.mode:true)&&(entry.code?job.code===entry.code:true)&&retained&&decodedMatches;
  const result={matched,originalMode:request.parameters.videoMode,metadataReads:trace.metadataReads,transportPasses:trace.transportPasses,adapterCaptured:trace.adapterCaptured,decoded:trace.decoded,mode,retained,status:job.status,code:job.code,error:job.error,providerDispatched:job.providerDispatched,payload:summarize(trace.capturedRequest||job.request)};
  results.set(entry.id,result);payload.textContent=JSON.stringify(result,null,2);
  const row=document.querySelector('[data-case="'+entry.id+'"]');
  row.cells[2].textContent=trace.decoded.map(value=>value.duration+' s · '+value.width+'×'+value.height).join('\n')||'没有媒体输入';
  row.cells[3].textContent='metadataReads='+trace.metadataReads+'\ntransportPasses='+trace.transportPasses+'\nadapterCaptured='+trace.adapterCaptured;
  row.cells[4].textContent=mode||'未到捕获适配器';row.cells[5].textContent=entry.subject||entry.wireElement?retained?'已保留':'丢失':'不含主体元素';
  row.cells[6].textContent=(matched?'符合预期':'结果不符合预期')+' · '+job.status+' · '+job.code+'\n'+job.error;
  row.cells[6].className='trace '+(matched?'ok':'bad');
}

async function perform(entries){
  if(running)return;running=true;error.textContent='';for(const button of buttons)button.disabled=true;
  try{for(const entry of entries)await run(entry);}catch(reason){error.textContent=reason.message;}
  finally{running=false;for(const button of buttons)button.disabled=false;}
}

for(const entry of cases){
  const row=document.createElement('tr');row.dataset.case=entry.id;
  for(let i=0;i<7;i++)row.append(document.createElement('td'));
  row.cells[0].textContent=entry.name;
  const button=document.createElement('button');button.type='button';button.textContent='执行';button.setAttribute('aria-label','执行 '+entry.name);button.onclick=()=>perform([entry]);row.cells[1].append(button);buttons.push(button);
  for(let i=2;i<7;i++)row.cells[i].textContent='待执行';tbody.append(row);
}
const all=document.querySelector('#run-all');all.onclick=()=>perform(cases);buttons.push(all);
window.VideoReferenceQa={results,runAll:()=>perform(cases)};
