const panel=document.createElement('aside');panel.style.cssText='position:fixed;left:80px;top:65px;z-index:80;background:#171717;color:white;padding:10px;font:12px sans-serif;max-width:340px';
const label=document.createElement('strong');label.textContent='延长镜头隔离验收 · 生产 UI · 无模型调用';panel.append(label);
const output=document.createElement('pre'),open=document.createElement('button');open.textContent='打开视频延长';open.onclick=async()=>{const {openExtend}=await import('/src/features/video-creation/ui.mjs');openExtend(CanvasApp.getState().nodes.find(node=>node.id==='extension-source'));write();};panel.append(open,output);document.body.append(panel);
function write(){output.textContent=JSON.stringify({...window.ExtensionFixture,source:CanvasApp.getState().nodes.find(node=>node.id==='extension-source')?.generation,jobs:GenerationAPI.getJobs().map(job=>({kind:job.request.kind,status:job.status}))},null,2);}
GenerationAPI.subscribe(write);write();
