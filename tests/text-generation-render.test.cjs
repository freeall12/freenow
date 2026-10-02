const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../canvas-text.js');

function fixture({count=4,edgeCount=3,script=fs.readFileSync(path.join(__dirname,'../text-generation-ui.js'),'utf8')}={}){
 const handlers=new Map(),metrics={edgeSourceReads:0,edgeTargetReads:0,replacements:0};
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.style={};this.className='';this.offsetHeight=180;}
  setAttribute(key,value){this.attributes[key]=value;}getAttribute(key){return this.attributes[key];}removeAttribute(key){delete this.attributes[key];}
  append(...children){this.children.push(...children);}prepend(...children){this.children.unshift(...children);}replaceChildren(){metrics.replacements++;this.children=[];}
  addEventListener(){}setCustomValidity(reason){this.validationMessage=reason;}
  querySelectorAll(selector){const result=[];const walk=e=>{for(const child of e.children){if(selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):child.tagName===selector)result.push(child);walk(child);}};walk(this);return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 }
 const target={id:'target',type:'text',textMode:'generate',x:100.125,y:42.375,width:300.25,height:250.125,generation:{prompt:'写脚本',model:'gemini-3.1-flash-lite',count:1}};
 const nodes=[target,...Array.from({length:count-1},(_,i)=>({id:`ref-${i}`,type:'text',title:`参考${i}`,content:`参考内容${i}`,x:i*.125,y:i*.375,width:250,height:250}))],edges=[];
 function edge(source,target,id){let from=source,to=target;return{id,get source(){metrics.edgeSourceReads++;return from;},set source(value){from=value;},get target(){metrics.edgeTargetReads++;return to;},set target(value){to=value;}};}
 for(let i=0;i<edgeCount;i++)edges.push(edge(nodes[1+(i%(count-1))].id,i===0?'target':`unselected-${i}`,`edge-${i}`));
 const state={nodes,edges,selected:['target'],view:{x:7.125,y:9.375,scale:.7}},jobs=[];
 const document={body:new Element('body'),activeElement:null,createElement:tag=>new Element(tag),addEventListener(name,fn){handlers.set(name,fn);},querySelector(selector){if(selector==='#canvas')return{getBoundingClientRect:()=>({left:10,top:20,width:1280,right:1290})};}};
 const app={getState:()=>state,updateNode(id,patch){Object.assign(nodes.find(n=>n.id===id),patch);render();}};
 const window={CanvasText:core,CanvasApp:app,UI_ICONS:{},TEXT_MODEL_ICONS:{},VoiceInput:{bind(){}},CanvasTextUI:{open(){},close(){}},GenerationAPI:{getJobs:()=>jobs,subscribe(){}},addEventListener(){}};
 const render=detail=>handlers.get('canvas:render')({detail});
 vm.runInNewContext(script,{window,document,innerHeight:900,innerWidth:1300});
 const panel=document.body.children[0];
 return{state,target,document,panel,metrics,render,edge,reset(){for(const key in metrics)metrics[key]=0;}};
}

test('text generation movement uses a linear edge pass and preserves composer DOM and exact position',()=>{
 const f=fixture({count:2000,edgeCount:3000}),prompt=f.panel.querySelector('textarea'),children=[...f.panel.children];f.reset();
 f.target.x+=.125;f.target.y-=.375;f.render();
 assert.ok(f.metrics.edgeSourceReads<=4,`${f.metrics.edgeSourceReads} source reads`);assert.ok(f.metrics.edgeTargetReads<=3002,`${f.metrics.edgeTargetReads} target reads`);
 assert.equal(f.metrics.replacements,0);assert.equal(f.panel.querySelector('textarea'),prompt);assert.deepEqual(f.panel.children,children);
 const {view}=f.state,w=680,x=10+(f.target.x+f.target.width/2)*view.scale+view.x,y=20+(f.target.y+f.target.height)*view.scale+view.y;
 assert.equal(f.panel.style.left,Math.max(22,Math.min(1290-w-12,x-w/2))+'px');assert.equal(f.panel.style.top,Math.max(72,Math.min(702,y+12))+'px');
 f.reset();f.state.view.x+=.375;f.render({viewportOnly:true});assert.equal(f.metrics.edgeSourceReads,0);assert.equal(f.metrics.edgeTargetReads,0);assert.equal(f.panel.querySelector('textarea'),prompt);
});

test('reference content, title, edge changes and model changes still invalidate the text composer',()=>{
 const f=fixture(),initial=f.panel.querySelector('textarea');f.state.nodes[2].content='unrelated change';f.render();assert.equal(f.panel.querySelector('textarea'),initial);
 f.state.nodes[1].content='changed reference';f.render();assert.notEqual(f.panel.querySelector('textarea'),initial);
 const renamed=f.panel.querySelector('textarea');f.state.nodes[1].title='重命名参考';f.render();assert.notEqual(f.panel.querySelector('textarea'),renamed);assert.equal(f.panel.querySelector('.text-reference-chip').children[0].getAttribute('aria-label'),'重命名参考');
 f.state.edges.push(f.edge('ref-1','target','new-edge'));f.render();assert.equal(f.panel.querySelectorAll('.text-reference-chip').length,2);
 f.state.edges.push(f.edge('ref-1','target','duplicate-edge'));f.render();assert.equal(f.panel.querySelectorAll('.text-reference-chip').length,2);
 f.state.edges=f.state.edges.filter(e=>e.source!=='ref-0');f.render();assert.equal(f.panel.querySelectorAll('.text-reference-chip').length,1);
 f.state.nodes=f.state.nodes.filter(n=>n.id!=='ref-1');f.render();assert.equal(f.panel.querySelector('.text-generate').disabled,true);assert.match(f.panel.querySelector('.text-generate').title,/不存在/);
 f.state.edges=[];f.target.generation.model='gpt-6-astra';f.render();assert.ok(f.panel.querySelectorAll('button').some(b=>b.getAttribute('aria-label')==='思考强度'));
});

test('reference ordering follows explicit config then edge order and typing retains focused textarea',()=>{
 const f=fixture();f.target.generation.referenceIds=['ref-1','ref-0'];f.state.edges.push(f.edge('ref-1','target','next-edge'));f.render();
 assert.deepEqual(f.panel.querySelectorAll('.text-reference-chip').map(chip=>chip.children[0].getAttribute('aria-label')),['参考1','参考0']);
 const prompt=f.panel.querySelector('textarea');f.document.activeElement=prompt;prompt.value='新提示';f.target.generation.prompt='新提示';f.render();assert.equal(f.panel.querySelector('textarea'),prompt);
 f.state.selected=[];f.render();assert.equal(f.panel.hidden,true);
});

module.exports={fixture};

test('pending operation changes update text action without replacing the live prompt',()=>{
 const f=fixture(),prompt=f.panel.querySelector('textarea'),generate=f.panel.querySelector('.text-generate');f.reset();
 assert.equal(generate.disabled,false);f.target.pendingOperation='preparing';f.render();
 assert.equal(generate.disabled,true);assert.equal(f.panel.getAttribute('aria-busy'),'true');assert.equal(f.panel.querySelector('textarea'),prompt);assert.equal(f.metrics.replacements,0);
 delete f.target.pendingOperation;f.render();assert.equal(generate.disabled,false);assert.equal(f.panel.getAttribute('aria-busy'),'false');assert.equal(f.panel.querySelector('textarea'),prompt);assert.equal(f.metrics.replacements,0);
});
