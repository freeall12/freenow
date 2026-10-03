import {openNodeImageRepair} from '../node-image-repair-ui.mjs';

const id=window.CanvasProjects.id(),old='https://files.tapnow.media/qa-unknown-node.png?token=synthetic-qa-only';
const status=document.querySelector('#status'),diagnostics=document.querySelector('#diagnostics'),previews=document.querySelector('#previews');
let live=null,renderVersion=0,lastSaved=null,localReads=0;
const seed=()=>({version:1,project:{id,title:'独立人工修复测试'},view:{x:0,y:0,scale:1},nodes:['selected','other'].map((id,index)=>({id,type:'image',title:index?'其他节点（应保持待导入）':'选择的测试节点',x:index*240,y:0,width:200,height:200,image:old,fullImage:old,generation:{model:'QA旧模型'},sourceJournal:{source:old,signature:'synthetic-keep'},provenance:{kind:'generation-result',mediaSource:old,model:'QA旧模型'}})),edges:[],history:[],future:[]});
function controls(){for(const selector of ['#open','#sample','#read'])document.querySelector(selector).disabled=!live;document.querySelector('#undo').disabled=!live?.history?.length;}
async function show(){
 const version=++renderVersion;previews.replaceChildren();controls();if(!live)return;
 diagnostics.textContent=JSON.stringify({projectId:id,originalReads:0,localFixtureReads:localReads,live:live.nodes.map(({id,image,fullImage,provenance,sourceJournal})=>({id,image,fullImage,provenance,sourceJournal})),saved:lastSaved?.nodes.map(({id,image,fullImage})=>({id,image,fullImage})),undoCount:live.history.length},null,2);
 for(const node of live.nodes){
  const figure=document.createElement('figure');figure.id='qa-node-'+node.id;figure.tabIndex=-1;const caption=document.createElement('figcaption');caption.textContent=node.title+'：待导入，原地址未读取';figure.append(caption);previews.append(figure);
  if(!node.image.startsWith('asset:'))continue;
  try{const image=document.createElement('img');image.alt=node.title;image.src=await window.LocalAssets.url(node.image);await image.decode();if(version!==renderVersion)return;figure.prepend(image);caption.textContent=node.title+'：真实本地图片 '+image.naturalWidth+' × '+image.naturalHeight;}
  catch(error){caption.textContent='本地图片解码失败：'+error.message;}
 }
}
const app={getState:()=>live,projectIdentity:()=>({id}),projectSnapshot:()=>structuredClone(live),getNodeElement:nodeId=>document.getElementById('qa-node-'+nodeId),updateNode(nodeId,patch){live.history.push({nodes:structuredClone(live.nodes),edges:structuredClone(live.edges)});live.future=[];Object.assign(live.nodes.find(node=>node.id===nodeId),patch);void show();},async saveProject(){if(document.querySelector('#fail-save').checked){document.querySelector('#fail-save').checked=false;throw Error('QA 模拟一次保存失败');}await window.CanvasStore.save(live,id,{preserveSnapshot:true});await window.CanvasStore.flush();lastSaved=await window.CanvasStore.load(id);await show();}};
function open(){return openNodeImageRepair({app,nodeId:'selected',assets:window.LocalAssets,isCurrent:()=>!!live,getJobs:()=>[],readProject:()=>window.CanvasStore.load(id)});}
async function act(operation){try{await operation();}catch(error){status.textContent='QA 操作失败：'+error.message;}}
document.querySelector('#initialize').onclick=()=>act(async()=>{const saved=await window.CanvasStore.load(id);if(saved){live=saved;status.textContent='保留已有独立 QA 画布，没有覆盖。';}else{live=seed();await app.saveProject();status.textContent='已保存两个合成旧节点；未请求原站。';}await show();});
document.querySelector('#open').onclick=()=>act(async()=>{open();});
document.querySelector('#sample').onclick=()=>act(async()=>{const response=await fetch('/assets/agent-casting.png',{credentials:'same-origin',mode:'same-origin',redirect:'error'});if(!response.ok)throw Error('本机 fixture 不可读取');localReads++;const blob=await response.blob(),handle=open(),input=handle.element.querySelector('input[type=file]'),transfer=new DataTransfer();transfer.items.add(new File([blob],'QA-用户替换样本.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));status.textContent='已选入真实本机 PNG。请在正式修复对话框点击导入并替换。';});
document.querySelector('#read').onclick=()=>act(async()=>{lastSaved=await window.CanvasStore.load(id);status.textContent='已回读实际持久画布；当前未保存编辑保持。';await show();});
document.querySelector('#undo').onclick=()=>act(async()=>{const previous=live.history.pop();if(!previous)return;live.future.push({nodes:structuredClone(live.nodes),edges:structuredClone(live.edges)});live.nodes=previous.nodes;live.edges=previous.edges;await app.saveProject();status.textContent='已撤销并保存测试替换；旧引用重新待导入，未读取原站。';});
document.querySelector('#reload').onclick=()=>location.reload();
window.NodeImageRepairQA={snapshot:()=>structuredClone(live),saved:()=>structuredClone(lastSaved),localReads:()=>localReads,app};
await act(async()=>{live=lastSaved=await window.CanvasStore.load(id);await show();status.textContent=live?'已回读独立 QA 持久画布；本地图片正在实际解码。':'尚无记录，请初始化独立测试画布。';});
