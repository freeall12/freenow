const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};const {JSDOM}=fabricRequire('jsdom');if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const originalLabels=['3D 片场 · 后续复刻','重命名','更多操作','标签 · 后续复刻'];
function fixture({count=4,indexed=true,pinned=false}={}){
 const dom=new JSDOM('<body><main id="canvas"><div id="nodes"></div></main><div id="node-toolbar"></div></body>',{url:'http://localhost:4173/',runScripts:'outside-only'}),window=dom.window,document=window.document,metrics={serialized:0,globalQueries:0,subtreeQueries:0,indexReads:0,attributeWrites:0},nodes=Array.from({length:count},(_,index)=>({id:'n'+index,type:'image',image:'image.png',width:200,height:100,x:index*250,y:0,...(pinned?{colorPins:['#f0606b']}: {})})),shells=new Map();
 const toolbar=()=>document.getElementById('node-toolbar');const fillToolbar=root=>{root.replaceChildren(...originalLabels.map(label=>{const button=document.createElement('button');button.setAttribute('aria-label',label);return button;}));};fillToolbar(toolbar());
 function shell(n){const root=document.createElement('section');root.className='node';root.dataset.id=n.id;root.innerHTML='<div class="node-title">Title</div><div class="node-body"><div class="placeholder">Empty</div></div>';return root;}
 for(const n of nodes){const root=shell(n);shells.set(n.id,root);document.getElementById('nodes').append(root);}
 const state={nodes,selected:[nodes[0]?.id].filter(Boolean),view:{x:0,y:0,scale:1}},updates=[];
 const app={getState:()=>state,render:()=>document.dispatchEvent(new window.CustomEvent('canvas:render')),updateNode(id,patch){updates.push({id,patch});Object.assign(nodes.find(n=>n.id===id),patch);this.render();},select(id){state.selected=[id];this.render();},notify(){}};if(indexed)app.getNodeElement=id=>{metrics.indexReads++;return shells.get(id);};
 window.CanvasApp=app;window.ResizeObserver=class{observe(){}};window.UI_ICONS={check:'<svg></svg>'};window.NodeEditor={closePopover(){}};
 const originalStringify=window.JSON.stringify;window.JSON.stringify=(...args)=>{metrics.serialized++;return originalStringify(...args);};
 for(const [prototype,method,key]of [[window.Document.prototype,'querySelector','globalQueries'],[window.Document.prototype,'querySelectorAll','globalQueries'],[window.Element.prototype,'querySelector','subtreeQueries'],[window.Element.prototype,'querySelectorAll','subtreeQueries'],[window.Element.prototype,'setAttribute','attributeWrites']]){const original=prototype[method];prototype[method]=function(...args){metrics[key]++;return original.apply(this,args);};}
 const source=fs.readFileSync(require.resolve('../node-actions.js'),'utf8').replace(/import\('[^']+'\)/g,'Promise.resolve({})');vm.runInContext(source,dom.getInternalVMContext());
 const render=detail=>document.dispatchEvent(new window.CustomEvent('canvas:render',{detail})),reset=()=>{for(const key of Object.keys(metrics))metrics[key]=0;};render();reset();
 return{dom,window,document,metrics,state,shells,toolbar,fillToolbar,shell,updates,render,reset,close:()=>window.close()};
}

test('500 stable pinned nodes across 90 full renders serialize/query/write nothing and preserve badge/button identity',()=>{
 const f=fixture({count:500,pinned:true});try{
  const dots=f.shells.get('n0').querySelector('.node-pin-dots'),buttons=[...f.toolbar().children],handlers=buttons.map(b=>b.onclick),observer=new f.window.MutationObserver(()=>{});observer.observe(f.document.body,{subtree:true,childList:true,attributes:true});f.reset();for(let i=0;i<90;i++)f.render();
  assert.deepEqual(f.metrics,{serialized:0,globalQueries:0,subtreeQueries:0,indexReads:45000,attributeWrites:0});assert.equal(observer.takeRecords().length,0);observer.disconnect();assert.equal(f.shells.get('n0').querySelector('.node-pin-dots'),dots);assert.deepEqual([...f.toolbar().children],buttons);assert.deepEqual(buttons.map(b=>b.onclick),handlers);
  f.reset();for(let i=0;i<90;i++)f.render({viewportOnly:true});assert.deepEqual(f.metrics,{serialized:0,globalQueries:0,subtreeQueries:0,indexReads:0,attributeWrites:0});
 }finally{f.close();}
});

test('in-place pin edits, pin order/legacy colors and body/type changes remain visible',()=>{
 const f=fixture({count:2,pinned:true});try{
  const n=f.state.nodes[0],root=f.shells.get(n.id);n.colorPins.push('#4ea8ff');f.render();let dots=root.querySelector('.node-pin-dots');assert.equal(dots.children.length,2);assert.equal(dots.getAttribute('aria-label'),'Pin 红色、蓝色');n.colorPins.reverse();f.render();assert.equal(root.querySelector('.node-pin-dots').getAttribute('aria-label'),'Pin 蓝色、红色');n.colorPins.length=0;f.render();assert.equal(root.querySelector('.node-pin-dots'),null);
  delete n.colorPins;n.color='#dd7777';f.render();assert.equal(root.querySelector('.node-pin-dots').getAttribute('aria-label'),'Pin 红色');n.type='custom';f.render();assert.equal(root.querySelector('.node-pin-dots'),null);assert.equal(root.querySelector('.node-body').style.border,'4px solid #dd7777');n.type='image';f.render();assert.equal(root.querySelector('.node-body').style.border,'');
 }finally{f.close();}
});

test('replaced shells, title/body subtrees and removed badges are restored without state changes',()=>{
 const f=fixture({count:1,pinned:true});try{
  const n=f.state.nodes[0];let root=f.shells.get(n.id);const title=f.document.createElement('div');title.className='node-title';root.querySelector('.node-title').replaceWith(title);f.render();assert.equal(title.querySelector('.node-pin-dots').children.length,1);
  title.querySelector('.node-pin-dots').remove();f.render();assert.ok(title.querySelector('.node-pin-dots'));
  const body=f.document.createElement('div');body.className='node-body';root.querySelector('.node-body').replaceWith(body);f.render();assert.equal(body.dataset.color,'');
  const replacement=f.shell(n);root.replaceWith(replacement);f.shells.set(n.id,replacement);f.render();assert.ok(replacement.querySelector('.node-pin-dots'));
 }finally{f.close();}
});

test('enhance placeholder replacement and missing bodies do not throw or remain stale',()=>{
 const f=fixture({count:1});try{
  const n=f.state.nodes[0],root=f.shells.get(n.id);n.image='';n.tool='enhance';f.render();let placeholder=root.querySelector('.placeholder');assert.equal(placeholder.textContent,'配置参数生成增强图像');placeholder.textContent='damaged';f.render();assert.equal(placeholder.textContent,'配置参数生成增强图像');const next=f.document.createElement('div');next.className='placeholder';placeholder.replaceWith(next);f.render();assert.equal(next.textContent,'配置参数生成增强图像');
  const body=root.querySelector('.node-body');body.remove();f.render();root.append(body);f.render();assert.equal(body.dataset.color,'');
 }finally{f.close();}
});

test('toolbar binds current selection, recovers rewritten controls and ignores video-owned controls',()=>{
 const f=fixture({count:2});try{
  let toolbar=f.toolbar(),pin=[...toolbar.children].at(-1),handler=pin.onclick;assert.equal(pin.getAttribute('aria-label'),'Pin');f.state.selected=['n1'];f.render();assert.equal(pin.onclick,handler);pin.click();assert.equal(f.document.querySelector('.color-pins').dataset.nodeId,'n1');f.document.querySelector('.color-pins button').click();assert.equal(f.updates.at(-1).id,'n1');f.window.NodeActions.closePop();
  pin.title='wrong';pin.disabled=true;pin.onclick=()=>{};pin.setAttribute('aria-label','标签 · 后续复刻');f.render();assert.equal(pin.title,'Pin');assert.equal(pin.disabled,false);assert.equal(pin.onclick,handler);
  const videoHandler=()=>{};pin.dataset.videoAction='Pin';pin.onclick=videoHandler;f.render();assert.equal(pin.onclick,videoHandler);delete pin.dataset.videoAction;f.render();assert.notEqual(pin.onclick,videoHandler);
  f.fillToolbar(toolbar);f.render();assert.equal(toolbar.lastChild.getAttribute('aria-label'),'Pin');assert.equal(typeof toolbar.lastChild.onclick,'function');const replacement=f.document.createElement('div');replacement.id='node-toolbar';f.fillToolbar(replacement);toolbar.replaceWith(replacement);f.render();assert.equal(replacement.lastChild.getAttribute('aria-label'),'Pin');
  f.state.selected=[];f.render();assert.ok([...replacement.children].every(button=>button.disabled));
 }finally{f.close();}
});

test('non-indexed standalone fixtures retain DOM lookup fallback',()=>{
 const f=fixture({count:3,indexed:false});try{f.render();assert.equal(f.metrics.globalQueries,3);assert.equal(f.metrics.serialized,0);assert.equal(f.metrics.subtreeQueries,0);}finally{f.close();}
});

test('actual audio sync chain retains its four controls, focused Pin and handler across full render and deselection',()=>{
 const f=fixture({count:2});try{
  const audio=f.state.nodes[1];audio.type='audio';delete audio.image;audio.audio='clip.wav';
  const source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' const audioBodies='),end=source.indexOf(' function reconcilePlayers(',start);
  vm.runInContext(`(()=>{const app=window.CanvasApp,$=selector=>document.querySelector(selector);const button=(label,ico,action)=>{const b=document.createElement('button');b.setAttribute('aria-label',label);b.onclick=action;return b;};const download=()=>{},preview=()=>{};${source.slice(start,end)}document.addEventListener('canvas:render',()=>{const state=app.getState(),node=state.nodes.find(n=>state.selected.length===1&&n.id===state.selected[0]);if(node?.type==='audio')syncToolbar(node);});})();`,f.dom.getInternalVMContext());
  f.state.selected=[audio.id];f.render();const controls=[...f.toolbar().children],pin=controls[0],handler=pin.onclick;assert.equal(controls.length,4);pin.focus();
  for(let i=0;i<30;i++)f.render();assert.deepEqual([...f.toolbar().children],controls);assert.equal(pin.disabled,false);assert.equal(pin.onclick,handler);assert.equal(f.document.activeElement,pin);
  f.state.selected=[];f.render();f.state.selected=[audio.id];f.render();assert.deepEqual([...f.toolbar().children],controls);assert.equal(pin.disabled,false);assert.equal(pin.onclick,handler);pin.click();assert.equal(f.document.querySelector('.color-pins').dataset.nodeId,audio.id);f.document.querySelector('.color-pins button').click();assert.equal(f.updates.at(-1).id,audio.id);assert.equal(audio.colorPins[0],'#f0606b');
 }finally{f.close();}
});
