const panel=document.createElement('aside');panel.style.cssText='position:fixed;left:80px;top:65px;z-index:80;background:#171717;color:white;padding:10px;font:12px sans-serif;max-width:340px';
const label=document.createElement('strong');label.textContent='隔离验收 · 真裁片，固定生成响应，主体旧存储拒写';panel.append(label);
const output=document.createElement('pre');panel.append(output);
function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=()=>Promise.resolve().then(fn).catch(error=>{output.textContent=error.message;});panel.append(b);}
button('打开视频延长',async()=>{const {openExtend}=await import('/video-creation-ui.mjs');openExtend(CanvasApp.getState().nodes.find(n=>n.id==='extension-source'));});
button('打开主体库',async()=>{const {openSubjects}=await import('/subject-library.mjs');openSubjects();});
const write=()=>{output.textContent=JSON.stringify({...window.LocalWorkflowFixture,nodes:CanvasApp.getState().nodes.length,jobs:GenerationAPI.getJobs().map(j=>({kind:j.request.kind,status:j.status,applied:j.applied}))},null,2);};
window.addEventListener('qa:local-workflows',write);GenerationAPI.subscribe(write);window.addEventListener('canvas:nodes-changed',write);document.body.append(panel);write();
