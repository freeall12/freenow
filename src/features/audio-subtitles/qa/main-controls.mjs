const app=window.CanvasApp,fixture=window.AudioSubtitleMainFixture,bar=document.createElement('aside');
bar.style.cssText='position:fixed;left:185px;right:190px;top:54px;z-index:2200;padding:10px;background:#25282b;color:#eee;font:12px system-ui;border:1px solid #555';
const heading=document.createElement('strong');heading.textContent='Seed 音频字幕主壳 QA · 合同回放，非 ASR / 模型生成';
const instruction=document.createElement('p');instruction.style.margin='5px 0';instruction.textContent='使用生产 TaskService、应用事务、音频本地化与 CanvasStore。供应商夹具只返回真实 2 秒 WAV 和显式 subtitle.text。可选原音频节点，用正式「生成音频」按钮提交。';
const output=document.createElement('output');output.ariaLabel='主壳音频字幕诊断';output.style.cssText='display:block;white-space:pre-wrap;overflow-wrap:anywhere;max-height:170px;overflow:auto;margin-top:6px';
const buttons=[];let saved=null,ready=false,lastError=null;
const subtitleInput=document.createElement('textarea');subtitleInput.ariaLabel='显式合同字幕文本';subtitleInput.value=fixture.subtitleText;subtitleInput.rows=2;subtitleInput.style.cssText='width:100%;font:12px system-ui';subtitleInput.oninput=()=>{fixture.subtitleText=subtitleInput.value;};
function row(node){const audio=app.getNodeElement(node.id)?.querySelector('audio');return {id:node.id,type:node.type,title:node.title,audio:node.audio,content:node.content,sourceAudioNodeId:node.sourceAudioNodeId,textMode:node.textMode,x:node.x,y:node.y,width:node.width,height:node.height,player:audio?{src:audio.getAttribute('src'),readyState:audio.readyState,duration:audio.duration,currentTime:audio.currentTime,paused:audio.paused,ended:audio.ended}:undefined};}
function draw(){output.textContent=JSON.stringify({ready,contractReplay:true,asr:false,modelCalls:0,fixtureProviderCalls:fixture.providerCalls,namespace:fixture.namespace,live:app.getState().nodes.map(row),edges:app.getState().edges,saved:saved?.nodes?.map(n=>({id:n.id,type:n.type,audio:n.audio,content:n.content,sourceAudioNodeId:n.sourceAudioNodeId})),savedEdges:saved?.edges,history:app.historyState(),jobs:window.GenerationAPI.getJobs().map(({id,status,request,resultIds,applied,applicationError,applicationAttempts})=>({id,status,acceptedParameters:request.parameters,resultIds,applied,applicationError,applicationAttempts})),held:fixture.held?.id,externalAttempts:fixture.externalAttempts,lastError},null,2);}
function action(label,run){const button=document.createElement('button');button.textContent=label;button.style.margin='4px 6px 0 0';button.disabled=true;button.onclick=async()=>{try{lastError=null;await run();}catch(error){lastError=error.message;app.notify(error.message);}draw();};bar.append(button);buttons.push(button);}
const latest=()=>window.GenerationAPI.getJobs().at(-1);
async function build(nodeId=fixture.sourceId){return window.AudioAPI.buildRequest(nodeId,{kind:'audio.generate',model:'doubao-seed-audio',subtitle:true,prompt:'QA 合同请求文本；不作为字幕来源',referenceIds:[]});}
async function submit(){const job=window.GenerationAPI.submit(await build());fixture.lastJobId=job.id;return job;}
async function waitApplied(jobId){for(let attempt=0;attempt<200;attempt++){const job=window.GenerationAPI.getJobs().find(job=>job.id===jobId);if(job?.applied||job?.applicationError||['failed','configuration_required','cancelled'].includes(job?.status))return job;await new Promise(done=>setTimeout(done,50));}throw Error('等待应用超时，请检查生产任务托盘');}
const saveProject=app.saveProject.bind(app);app.saveProject=async()=>{if(fixture.failNextSave){fixture.failNextSave=false;throw Error('QA 显式阻断一次字幕确认保存；画布可能已由生产自动保存');}return saveProject();};
window.GenerationAPI.setProvider({isConfigured:async()=>true,generate:async(request,{jobId})=>{
 if(request.kind!=='audio.generate')throw Error('字幕合同夹具只支持 audio.generate');fixture.providerCalls++;const text=fixture.subtitleText;
 if(fixture.holdNext){fixture.holdNext=false;await new Promise(resolve=>{fixture.held={id:jobId,release:()=>{fixture.held=null;resolve();draw();}};draw();});}
 return {outputs:[{type:'audio',audio:new URL('/src/features/audio-subtitles/qa/contract-tone.wav',location.href).href,title:'本机真实 WAV · 合同结果',subtitle:{text}}]};
}});
bar.append(heading,instruction,subtitleInput);
action('选择原音频来源',()=>app.select(fixture.sourceId));
action('Agent 同入口请求并生成',async()=>{const job=await submit();await waitApplied(job.id);});
action('原位更新最新结果字幕',async()=>{const id=latest()?.resultIds?.[0],node=app.getState().nodes.find(n=>n.id===id);if(!node)throw Error('请先成功应用一项音频结果');const request=await build(id),snapshot=JSON.stringify(node);return window.GenerationAPI.runInPlace(request,{type:'audio',guard:()=>{if(!app.getState().nodes.includes(node)||JSON.stringify(node)!==snapshot)throw Error('QA 原位来源变化');}},{onSubmitted:job=>{fixture.lastJobId=job.id;}});});
action('阻断下一次字幕确认保存',()=>{fixture.failNextSave=true;});
action('重试最近应用结果',async()=>{const job=latest();if(!job)throw Error('没有任务');await window.GenerationAPI.retryApplication(job.id);});
action('保存并实际回读',async()=>{await app.saveProject();saved=await window.CanvasStore.load();});
action('只回读持久记录',async()=>{saved=await window.CanvasStore.load();});
action('撤销一次并保存',async()=>{app.undo();await app.saveProject();saved=await window.CanvasStore.load();});
action('重做一次并保存',async()=>{app.undo(true);await app.saveProject();saved=await window.CanvasStore.load();});
action('暂停下一次供应商合同回执',()=>{if(fixture.held)throw Error('请先释放旧回执');fixture.holdNext=true;});
action('释放旧合同回执',()=>{if(!fixture.held)throw Error('没有暂停的回执');fixture.held.release();});
action('刷新复验',()=>location.reload());
const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='展开字幕合同诊断';summary.style.cursor='pointer';details.append(summary,output);bar.append(details);document.body.append(bar);
window.GenerationAPI.subscribe(()=>queueMicrotask(draw));document.addEventListener('canvas:render',()=>queueMicrotask(draw));for(const event of ['loadedmetadata','timeupdate','ended'])document.addEventListener(event,draw,true);
window.AudioSubtitleMainQA={app,submit,waitApplied,snapshot:()=>app.projectSnapshot(),diagnostics:()=>JSON.parse(output.textContent),read:async()=>{saved=await window.CanvasStore.load();draw();return structuredClone(saved);}};
await window.CanvasResourceDisplayReady;
for(let attempt=0;attempt<100;attempt++){try{saved=await window.CanvasStore.load();if(!saved){await app.saveProject();saved=await window.CanvasStore.load();}ready=true;break;}catch(error){if(!/尚未成功读取/.test(error.message)){lastError=error.message;break;}await new Promise(done=>setTimeout(done,100));}}
for(const button of buttons)button.disabled=!ready;draw();
