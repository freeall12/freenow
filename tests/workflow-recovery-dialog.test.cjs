const {test}=require('node:test'),assert=require('node:assert/strict');
const ready=import('../src/features/workflow-recovery/dialog.mjs');
function dom(){
 const listeners=new Map(),document={addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);}};
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.disabled=false;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
  get isConnected(){return this===document.body||!!this.parent?.isConnected;}
  setAttribute(key,value){this.attributes[key]=value;}
  focus(){if(!this.disabled)document.activeElement=this;}
  showModal(){this.open=true;}
  close(){this.open=false;this.onclose?.();}
 }
 document.createElement=tag=>new Element(tag);document.body=new Element('body');const previous=new Element('button');document.body.append(previous);previous.focus();
 const find=(test,node=document.body)=>node.children.flatMap(child=>[...(test(child)?[child]:[]),...find(test,child)]);
 return {document,listeners,previous,find};
}
test('unknown recovery exposes original IDs, disables continuation and tears down events with restored focus',async()=>{
 const {openRecoveryDialog}=await ready,f=dom(),run={runId:'r',groupId:'g',plan:{layers:[['a'],['b']]},tasks:{a:{nodeId:'a',state:'unknown',taskId:'old-task',error:'404'},b:{nodeId:'b',state:'pending'}}};
 const host={writable:true,error:null,snapshot:()=>structuredClone(run),continuation:()=>({ok:false,reason:'先查询原任务'}),canRestart:()=>false,query:async()=>{}};
 const dialog=openRecoveryDialog({root:{document:f.document},app:{getState:()=>({nodes:[{id:'a',title:'第一镜头'}]})},host,groupId:'g',run});
 assert.equal(f.find(node=>node.textContent==='继续未发层')[0].disabled,true);assert.equal(f.find(node=>node.textContent==='查询原任务')[0].disabled,false);assert.equal(f.document.activeElement.textContent,'查询原任务');assert.ok(f.find(node=>node.tagName==='code'&&node.textContent==='old-task').length);
 dialog.close();assert.equal(f.listeners.size,0);assert.equal(f.document.activeElement,f.previous);assert.equal(dialog.isConnected,false);
});
test('completed snapshot updates the open dialog and disabled query falls back to close focus',async()=>{
 const {openRecoveryDialog}=await ready,f=dom(),run={runId:'r',groupId:'g',plan:{layers:[['a']]},tasks:{a:{nodeId:'a',state:'applying',taskId:'old-task'}}};
 const host={writable:true,snapshot:()=>structuredClone(run),continuation:()=>({ok:false,reason:'工作流已完成'}),canRestart:()=>false};
 const dialog=openRecoveryDialog({root:{document:f.document},app:{getState:()=>({nodes:[]})},host,groupId:'g',run});run.tasks.a.state='applied';f.listeners.get('workflow:change')({detail:{groupId:'g'}});
 assert.equal(f.find(node=>node.dataset.nodeId==='a')[0].dataset.state,'applied');assert.equal(f.find(node=>node.textContent==='查询原任务')[0].disabled,true);dialog.close();
 const complete=openRecoveryDialog({root:{document:f.document},app:{getState:()=>({nodes:[]})},host,groupId:'g',run});assert.equal(f.document.activeElement.textContent,'关闭');complete.close();
});
