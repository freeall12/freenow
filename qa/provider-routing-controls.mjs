const api=window.GenerationAPI,fixture=window.ProviderRoutingFixture;
const panel=document.createElement('aside');panel.setAttribute('aria-label','隔离路由验收');panel.style.cssText='position:fixed;left:80px;top:65px;z-index:80;background:#171717;border:1px solid #444;color:#eee;padding:12px;font:12px sans-serif;max-width:340px';
const title=document.createElement('strong');title.textContent='隔离路由验收 · 固定图片响应，无外部调用';panel.append(title);
const output=document.createElement('pre');output.setAttribute('aria-label','路由验收计数');panel.append(output);
let availability=null,applied=0,error='';
const write=()=>{output.textContent=JSON.stringify({...fixture,applied,availability,error,jobs:api.getJobs().map(j=>({kind:j.request.kind,status:j.status}))},null,2);};
function button(label,run){const b=document.createElement('button');b.textContent=label;b.onclick=()=>Promise.resolve().then(run).catch(e=>{error=e.message;write();});panel.append(b);}
button('检查分镜解析可用性',async()=>{availability=await api.availability({kind:'video.analyze'});write();});
button('尝试未配置视频',()=>api.submit({kind:'video.generate',prompt:'隔离测试',inputs:[{type:'video',url:'/qa/trim-scenes.mp4'}],parameters:{model:'Seedance 2.0',mode:'全能参考',quality:'720p',duration:5,count:1}}));
button('生成固定测试图片',()=>api.runInPlace({kind:'image.generate',prompt:'隔离测试',parameters:{model:'gpt-image-2',ratio:'1:1',quality:'1K',count:1}},{guard(){},type:'image',apply:async()=>{applied++;write();}}));
button('查看服务配置',()=>api.configure());document.body.append(panel);
window.addEventListener('qa:routing-change',write);api.subscribe(write);write();
