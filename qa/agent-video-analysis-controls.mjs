const app=window.CanvasApp,fixture=window.AgentVideoAnalysisFixture;
const panel=document.createElement('aside');panel.style.cssText='position:fixed;left:80px;top:65px;z-index:80;background:#171717;border:1px solid #444;color:#eee;padding:8px;font:12px sans-serif;max-width:330px';
panel.setAttribute('aria-label','隔离分镜验收');const title=document.createElement('strong');title.textContent='隔离验收 · 固定 Agent/描述，真实本机裁片';panel.append(title);
const output=document.createElement('pre');output.setAttribute('aria-label','分镜验收计数');panel.append(output);
const configure=document.createElement('button');configure.textContent='切换夹具服务配置';configure.onclick=()=>{fixture.setConfigured(!fixture.state.configured);window.GenerationAPI.configure();};panel.append(configure);document.body.append(panel);
function write(){const state=app.getState();output.textContent=JSON.stringify({configured:fixture.state.configured,posts:fixture.state.posts.length,mediaReads:fixture.state.mediaReads,receiptBeforeDispatch:fixture.state.posts.every(p=>p.acknowledged),nodes:state.nodes.length,edges:state.edges.length,jobs:window.GenerationAPI.getJobs().map(j=>({status:j.status,applied:j.applied,resultIds:j.resultIds}))},null,2);}
window.addEventListener('qa-agent-analysis:change',write);window.GenerationAPI.subscribe(write);window.addEventListener('canvas:nodes-changed',write);write();
window.addEventListener('load',()=>{if(!localStorage.getItem('qa-agent-analysis-view')){document.querySelector('#reset').click();try{localStorage.setItem('qa-agent-analysis-view','set');}catch{}}window.AgentUI.open();},{once:true});
