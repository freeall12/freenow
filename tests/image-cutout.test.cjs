const {test}=require('node:test'),assert=require('node:assert/strict'),api=import('../image-cutout-core.mjs');
test('cutout submits no invented model prompt or generation controls',async()=>{const c=await api,source={id:'source',type:'image',image:'thumbnail',fullImage:'full'};assert.deepEqual(c.request(source,'target','data:image/png;base64,x'),{kind:'image.remove-background',label:'抠图',nodeId:'target',sourceNodeId:'source',prompt:'',inputs:[{type:'image',nodeId:'source',url:'data:image/png;base64,x'}],parameters:{}});assert.throws(()=>c.request({type:'video',image:'poster'},'target','x'),/未选择图片/);});
test('cutout rejects changed media and object replacement but permits source movement',async()=>{const c=await api,n={id:'s',type:'image',image:'a',x:.25};assert.equal(c.sourceMatches(n,n,'a'),true);n.x+=5;assert.equal(c.sourceMatches(n,n,'a'),true);assert.equal(c.sourceMatches({...n},n,'a'),false);n.image='b';assert.equal(c.sourceMatches(n,n,'a'),false);});
test('cleanup only removes exact untouched placeholder',async()=>{const c=await api,n={id:'t',image:null,title:'抠图',pendingOperation:'image.remove-background'},s=JSON.stringify(n);assert.equal(c.untouched(n,n,s),true);assert.equal(c.untouched({...n},n,s),false);n.title='keep me';assert.equal(c.untouched(n,n,s),false);assert.equal(c.untouched(undefined,n,s),false);});

test('cutout renderer avoids ordinary-node DOM scans and preserves decoration lifecycle',async t=>{
 const saved={window:global.window,document:global.document};
 const counts={lookups:0,queries:0,scans:0},listeners=new Map(),elements=new Map();
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.className='';this.value='';this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(' ').filter(Boolean));on?classes.add(name):classes.delete(name);this.className=[...classes].join(' ');},contains:name=>this.className.split(' ').includes(name)};}
  get isConnected(){return this.root===true||!!this.parentNode?.isConnected;}
  append(...children){for(const child of children){child.remove();child.parentNode=this;this.children.push(child);}}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}}
  contains(child){return this===child||this.children.some(node=>node.contains(child));}
  setAttribute(key,value){this.attributes[key]=String(value);}
  get textContent(){return this.value+this.children.map(node=>node.textContent).join('');}
  set textContent(value){for(const child of [...this.children])child.remove();this.value=value;}
  set innerHTML(value){this.textContent='';if(value.includes('<svg'))this.append(new Element('svg'));}
  set outerHTML(value){const parent=this.parentNode,index=parent.children.indexOf(this),replacement=new Element(value.includes('<svg')?'svg':'div');this.remove();parent.children.splice(index,0,replacement);replacement.parentNode=parent;}
  querySelector(selector){counts.queries++;const match=node=>selector.startsWith('.')?node.classList.contains(selector.slice(1)):node.tagName===selector;const walk=node=>{for(const child of node.children){if(match(child))return child;const found=walk(child);if(found)return found;}return null;};return walk(this);}
 }
 const head=new Element('head'),body=new Element('body');head.root=body.root=true;
 const state={nodes:[],selected:[]},notifications=[];
 const app={getState:()=>state,getNodeElement:id=>{counts.lookups++;return elements.get(id)||null;},notify:message=>notifications.push(message),updateNode:(id,patch)=>Object.assign(state.nodes.find(node=>node.id===id),patch)};
 const reset=()=>Object.keys(counts).forEach(key=>counts[key]=0),render=detail=>listeners.get('canvas:render')({detail});
 const shell=node=>{const element=new Element('div');elements.set(node.id,element);body.append(element);return element;};
 global.document={head,body,baseURI:'https://local.test/',createElement:tag=>new Element(tag),createTextNode:value=>{const node=new Element('#text');node.textContent=value;return node;},addEventListener:(type,fn)=>listeners.set(type,fn),querySelectorAll:()=>{counts.scans++;throw Error('full document scan');},querySelector:()=>{counts.scans++;throw Error('full document lookup');}};
 global.window={CanvasApp:app,CANVAS_MENU_ICONS:{removeBackground:'<svg></svg>'},NodeActions:{close(){},closePop(){}}};
 try{
  const ui=await import('../image-cutout-ui.mjs?renderer-regression');
  await t.test('500 ordinary nodes across 90 drag renders perform zero DOM lookups or queries',()=>{
   state.nodes=Array.from({length:500},(_,i)=>({id:`ordinary-${i}`,type:'image',image:'local.png',x:i+.25,y:i+.75}));
   const before=JSON.stringify(state.nodes);reset();
   for(let frame=0;frame<90;frame++)render();
   assert.deepEqual(counts,{lookups:0,queries:0,scans:0});assert.equal(JSON.stringify(state.nodes),before);
  });
  const result={id:'result',type:'image',image:'result.png',cutoutResult:true,x:.25,y:.75},pending={id:'pending',type:'image',image:'source.png',pendingOperation:'image.remove-background'},placeholderNode={id:'placeholder',type:'image',pendingOperation:'image.remove-background'};
  const resultElement=shell(result),pendingElement=shell(pending),placeholderElement=shell(placeholderNode),placeholder=new Element('div');placeholder.className='placeholder';placeholderElement.append(placeholder);
  state.nodes.push(result,pending,placeholderNode);state.selected=[pending.id];
  await t.test('warm pending and result decorations preserve nodes and avoid subtree queries',()=>{
   render();assert.equal(resultElement.children[0].className,'cutout-rerun');assert.equal(pendingElement.children[0].className,'cutout-pending-overlay');assert.match(pendingElement.textContent,/抠图已中断/);assert.match(placeholder.textContent,/抠图已中断/);assert.equal(body.classList.contains('image-cutout-pending'),true);
   const before=JSON.stringify(state.nodes),again=resultElement.children[0],overlay=pendingElement.children[0];reset();
   for(let frame=0;frame<90;frame++)render();
   assert.deepEqual(counts,{lookups:270,queries:0,scans:0});assert.equal(resultElement.children[0],again);assert.equal(pendingElement.children[0],overlay);assert.equal(JSON.stringify(state.nodes),before);
   reset();render({viewportOnly:true});assert.deepEqual(counts,{lookups:0,queries:0,scans:0});
  });
  await t.test('in-place pending transitions, selection, deletion and undo clean and restore decorations',()=>{
   pending.pendingOperation=null;pending.cutoutResult=true;render();assert.equal(pendingElement.children.length,1);assert.equal(pendingElement.children[0].className,'cutout-rerun');assert.equal(body.classList.contains('image-cutout-pending'),false);
   pending.pendingOperation='image.remove-background';render();assert.equal(pendingElement.children.length,1);assert.equal(pendingElement.children[0].className,'cutout-pending-overlay');
   state.selected=[pending.id,result.id];render();assert.equal(body.classList.contains('image-cutout-pending'),false);
   state.nodes=state.nodes.filter(node=>node!==result);render();assert.equal(resultElement.children.length,0);
   state.nodes.push(result);render();assert.equal(resultElement.children.length,1);
   const replacement=shell(result);render();assert.equal(resultElement.children.length,0);assert.equal(replacement.children.length,1);
   replacement.children[0].remove();render();assert.equal(replacement.children.length,1);
   elements.delete(result.id);render();assert.equal(replacement.children.length,0);
   const nextPlaceholder=new Element('div');nextPlaceholder.className='placeholder';placeholder.remove();placeholderElement.append(nextPlaceholder);render();assert.match(nextPlaceholder.textContent,/抠图已中断/);
   pending.image=null;const empty=new Element('div');empty.className='placeholder';pendingElement.append(empty);render();assert.equal(pendingElement.children.length,1);assert.match(empty.textContent,/抠图已中断/);
  });
  await t.test('registered menu state follows real pending operations without document scanning',async()=>{
   const source={id:'menu-source',type:'image',image:'asset.png'};state.nodes.push(source);shell(source);
   const button=new Element('button');button.innerHTML='<svg></svg>';body.append(button);ui.bindMenu(button,source.id);assert.equal(button.disabled,false);
   let rejectMedia;window.LocalAssets={url:()=>new Promise((resolve,reject)=>{rejectMedia=reject;})};window.GenerationAPI={isConfigured:()=>false};
   const submitting=ui.submit(source.id);assert.equal(button.disabled,true);assert.equal(button.attributes['aria-busy'],'true');reset();render();assert.equal(counts.queries,0);assert.equal(counts.scans,0);
   rejectMedia(Error('media unavailable'));await submitting;assert.equal(button.disabled,false);assert.equal(button.attributes['aria-busy'],'false');assert.deepEqual(notifications,['media unavailable']);
   button.remove();render();reset();render();assert.equal(counts.queries,0);assert.equal(counts.scans,0);
  });
  await t.test('in-place active pending overlay and cancellation leave existing image intact',async()=>{
   const source={id:'active-source',type:'image',image:'original.png',cutoutResult:true,x:10.25,y:30.75};state.nodes.push(source);state.selected=[source.id];const element=shell(source);render();
   let resolveMedia;window.LocalAssets={url:()=>new Promise(resolve=>{resolveMedia=resolve;})};window.GenerationAPI={isConfigured:()=>true};
   const submitting=ui.submit(source.id,{inPlace:true});assert.equal(element.children.length,1);assert.equal(element.children[0].className,'cutout-pending-overlay');assert.equal(element.textContent,'正在抠图…');assert.equal(body.classList.contains('image-cutout-pending'),true);
   ui.cancel(source.id);resolveMedia('https://example.test/source.png');await submitting;
   assert.equal(source.image,'original.png');assert.equal(source.pendingOperation,null);assert.equal(source.x,10.25);assert.equal(source.y,30.75);assert.equal(element.children.length,1);assert.equal(element.children[0].className,'cutout-rerun');assert.equal(body.classList.contains('image-cutout-pending'),false);assert.equal(notifications.at(-1),'已取消抠图');
  });
 }finally{if(saved.window===undefined)delete global.window;else global.window=saved.window;if(saved.document===undefined)delete global.document;else global.document=saved.document;}
});
