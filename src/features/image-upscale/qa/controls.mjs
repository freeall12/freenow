import {open} from '../../../../image-enhance-ui.mjs';
import {parameters} from '../../../../image-enhance-core.mjs';
const app=window.CanvasApp,f=window.MagnificFixture,panel=document.createElement('aside');
panel.setAttribute('aria-label','Magnific 隔离验收');panel.style.cssText='position:fixed;left:78px;top:65px;z-index:80;background:#171717;color:white;padding:10px;font:12px sans-serif;max-width:310px';panel.onpointerdown=e=>e.stopPropagation();
panel.innerHTML='<strong>Magnific 隔离验收 · 正式增强面板</strong><p>公开合成素材；内存偏好、独立数据库；没有真实 Key、用户资源或模型调用。正式网关、原生适配和完整图片验证；供应商与下载边界为本机合成，固定结果不代表实际放大效果。</p>';
const output=document.createElement('pre');output.style.cssText='max-height:230px;overflow:auto';
const source=()=>app.getState().nodes.find(node=>node.id==='magnific-source');
const target=()=>app.getState().nodes.find(node=>node.tool==='enhance'&&app.getState().selected.includes(node.id))||app.getState().nodes.find(node=>node.tool==='enhance');
const add=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>Promise.resolve().then(fn).catch(error=>{f.error=error.message;write();});panel.append(b);};
const save=app.saveProject.bind(app);app.saveProject=async()=>{f.saveAttempts++;if(f.failSave){f.failSave=false;throw Error('隔离夹具：模拟一次保存失败');}return save();};
add('打开正式 Magnific 放大',()=>{const existing=target(),node=open(existing||source(),!!existing);if(parameters(node.params).activeTab!=='upscale'||parameters(node.params).upscaleProvider!=='magnific')app.updateNode(node.id,{params:parameters({...node.params,activeTab:'upscale',upscaleProvider:'magnific'})});app.setView({scale:1,x:640-(node.x+node.width/2),y:65-node.y});});
add('未配置 / 合成原生接口已配置',async()=>{f.configured=!f.configured;await window.ImageEnhance.active?.refreshReadiness();write();});
add('延迟下次配置',()=>{f.armDelay=true;});add('释放迟到配置',()=>f.release());
add('切换来源 fullImage',()=>{const n=source();app.updateNode(n.id,{fullImage:n.fullImage===f.sourceAsset?f.otherAsset:f.sourceAsset});});
add('下一次保存失败',()=>{f.failSave=true;});
add('下一次状态未知',async()=>{await fetch('/api/generation/fixture-control',{method:'POST',body:JSON.stringify({unknown:true})});});
add('释放原任务结果',async()=>{await fetch('/api/generation/fixture-control',{method:'POST',body:JSON.stringify({releaseUnknown:true})});});
if(window.MagnificAgentFixture){add('Agent 新增强节点',()=>window.MagnificAgentFixture.useTarget(null));add('Agent 写回当前增强',()=>window.MagnificAgentFixture.useTarget(target()?.id));add('Agent 四参 3/14/29/41',()=>window.MagnificAgentFixture.setParameters({provider:'magnific',scaleFactor:3,sharpen:14,smartGrain:29,ultraDetail:41}));}
panel.append(output);document.body.append(panel);
function write(){const n=target();output.textContent=JSON.stringify({pipeline:f.pipeline,serverAudit:f.serverAudit,agentReceipts:window.MagnificAgentFixture?.generationReceipts,agentParameters:window.MagnificAgentFixture?.upscale,parameters:n?.params,enhancements:app.getState().nodes.filter(node=>node.tool==='enhance').map(node=>({id:node.id,parameters:node.params,versions:node.versions?.length||0,result:node.fullImage,incoming:app.getState().edges.filter(edge=>edge.target===node.id)})),incoming:app.getState().edges.filter(edge=>edge.target===n?.id),configured:f.configured,posts:f.posts,pendingConfigurations:f.pendingConfigurations,saveAttempts:f.saveAttempts,blockedExternal:f.blockedExternal,blockedAPI:f.blockedAPI,databases:f.databases(),jobs:window.GenerationAPI.getJobs().map(job=>({id:job.id,status:job.status,applied:job.applied,applicationError:job.applicationError,kind:job.request.kind})),requests:f.requests,nodes:app.getState().nodes.length,versions:n?.versions?.length||0,result:n?.fullImage,operation:window.ImageEnhance.active?.root.dataset.operation,panelAlive:window.ImageEnhance.active?.alive??false,error:f.error},null,2);}
const blob=await (await fetch('/src/features/image-upscale/qa/source.png')).blob(),existing=source();
if(existing?.fullImage?.startsWith('asset:')){f.sourceAsset=existing.fullImage;f.otherAsset=await window.LocalAssets.put(blob);}
else{f.sourceAsset=await window.LocalAssets.put(blob);f.otherAsset=await window.LocalAssets.put(blob);app.updateNode(existing.id,{image:f.sourceAsset,fullImage:f.sourceAsset});await save();}
f.seeded=true;window.GenerationAPI.subscribe(write);setInterval(write,300);write();
if(f.pipeline)setInterval(async()=>{try{f.serverAudit=await(await fetch('/api/generation/fixture-audit')).json();write();}catch(error){f.error=error.message;}},1000);
