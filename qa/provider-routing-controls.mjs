const api=window.GenerationAPI,fixture=window.ProviderRoutingFixture;
const panel=document.createElement('aside');panel.setAttribute('aria-label','隔离路由验收');panel.style.cssText='position:fixed;left:80px;top:65px;z-index:80;background:#171717;border:1px solid #444;color:#eee;padding:12px;font:12px sans-serif;max-width:340px';
const title=document.createElement('strong');title.textContent='隔离路由验收 · 固定图片响应，无外部调用';panel.append(title);
const output=document.createElement('pre');output.setAttribute('aria-label','路由验收计数');output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto';panel.append(output);
let availability=null,applied=0,error='';
const write=()=>{output.textContent=JSON.stringify({...fixture,applied,availability,error,pendingNodes:window.CanvasApp.getState().nodes.filter(node=>node.pendingOperation).length,jobs:api.getJobs().map(j=>({kind:j.request.kind,status:j.status,model:j.request.parameters?.providerParameters?.model||j.request.parameters?.model,code:j.code,error:j.error,providerDispatched:j.providerDispatched}))},null,2);};
function button(label,run){const b=document.createElement('button');b.textContent=label;b.onclick=()=>Promise.resolve().then(run).catch(e=>{error=e.message;write();});panel.append(b);}
button('检查分镜解析可用性',async()=>{availability=await api.availability({kind:'video.analyze'});write();});
button('尝试未配置视频',()=>api.submit({kind:'video.generate',prompt:'隔离测试',inputs:[{type:'video',url:'/qa/trim-scenes.mp4'}],parameters:{model:'Seedance 2.0',mode:'全能参考',quality:'720p',duration:5,count:1}}));
button('生成固定测试图片',()=>api.runInPlace({kind:'image.generate',prompt:'隔离测试',parameters:{model:'gpt-image-2',ratio:'1:1',quality:'1K',count:1}},{guard(){},type:'image',apply:async()=>{applied++;write();}}));
button('合成直连 Ark：仅映射 Seedance 2.5',()=>{window.ProviderRoutingFixtureSetMode('direct-ark');availability=null;error='';write();});
let formalNodeId=null;
button('准备正式 Seedance 2.0 视频节点',()=>{
 if(!window.NodeEditor?.setConfig)throw Error('正式节点编辑器尚未就绪，请稍后重试');
 const app=window.CanvasApp;
 const node=app.getState().nodes.find(item=>item.id===formalNodeId)||app.addTypedNode('video');formalNodeId=node.id;
 app.updateNode(node.id,{title:'合成配置验收 · Seedance 2.0'});
 window.NodeEditor.setConfig(node.id,{model:'Seedance 2.0',prompt:'合成配置预检，请拒绝未映射型号',mode:'首尾帧',videoMode:'TEXT_TO_VIDEO',quality:'720p',duration:5,count:1});
 app.select(node.id,true);write();
});
const notice=document.createElement('p');notice.textContent='直连模式只模拟已配置公开能力，不填写真实 Key。准备节点后点击正式编辑器的生成按钮；预期 seedance-2.0 未映射，可用 seedance-2.5，posts=0。';panel.append(notice);
button('切回原隔离路由模式',()=>{window.ProviderRoutingFixtureSetMode('routed');availability=null;error='';write();});
button('查看服务配置',()=>api.configure());document.body.append(panel);
window.addEventListener('qa:routing-change',write);api.subscribe(write);write();
