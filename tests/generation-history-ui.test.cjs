'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function dom(){
  const document={};
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.className='';this.classList={add:name=>{this.className+=' '+name;},toggle:(name,active)=>{const all=new Set(this.className.split(' ').filter(Boolean));active??=!all.has(name);active?all.add(name):all.delete(name);this.className=[...all].join(' ');return active;}};}
    append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);this.parent=null;}
    replaceWith(node){const parent=this.parent,index=parent.children.indexOf(this);parent.children[index]=node;node.parent=parent;this.parent=null;}
    replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
    get isConnected(){return this===document.body||this===document.head||!!this.parent?.isConnected;}
    setAttribute(key,value){this.attrs[key]=String(value);}getAttribute(key){return this.attrs[key];}removeAttribute(key){delete this.attrs[key];if(key==='src')this.src='';}
    querySelectorAll(selector){return this.children.flatMap(node=>[...(selector==='[data-history-id]'&&node.dataset.historyId?[node]:[]),...node.querySelectorAll(selector)]);}
    focus(){document.activeElement=this;}
    click(){if(!this.disabled)return this.onclick?.();}
  }
  document.createElement=tag=>new Element(tag);document.head=new Element('head');document.body=new Element('body');document.activeElement=document.body;document.querySelector=()=>null;
  const panel=new Element('aside'),head=new Element('header');panel.append(head);document.body.append(panel);
  const find=(predicate,node=panel)=>node.children.flatMap(child=>[...(predicate(child)?[child]:[]),...find(predicate,child)]);
  return {document,panel,head,find};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const row=(id,type='image')=>({id,taskId:id.split(':')[0],type,outputIndex:0,title:'same prompt',prompt:'same prompt',createdAt:'2026-10-02T08:00:00Z',archiveStatus:'ready'});
async function setup({rows=[row('first:0'),row('second:0')],load,thumbnail,acquireThumbnail}={}){
  const fixture=dom();global.document=fixture.document;const {mountHistory}=await import('../src/features/generation-history/ui.mjs');const listeners=new Set(),applied=[],previewed=[],downloads=[];
  const history={list:({type,search}={})=>rows.filter(row=>(!type||row.type===type)&&(!search||row.prompt.includes(search))),diagnostics:()=>({receipts:[]}),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},thumbnail:thumbnail || (async()=>null),...(acquireThumbnail?{acquireThumbnail}:{}),apply:async rows=>applied.push(rows.map(row=>row.id)),preview:async row=>previewed.push(row.id),download:async rows=>downloads.push(rows.map(row=>row.id))};
  const dispose=mountHistory({...fixture,app:{notify(){}},loadHistory:load || (async()=>history)});await tick();return {...fixture,history,listeners,applied,previewed,downloads,dispose};
}
test('closing while loading avoids late subscriptions or reopening the history drawer',async()=>{
  let finish;const f=await setup({load:()=>new Promise(resolve=>finish=resolve)});f.dispose();f.panel.remove();finish(f.history);await tick();assert.equal(f.listeners.size,0);assert.equal(f.panel.isConnected,false);assert.equal(f.find(node=>node.dataset.historyId).length,0);
});
test('multiselect keys identical prompt rows by stable IDs and applies them together; preview stays explicit',async()=>{
  const f=await setup();assert.equal(f.find(node=>node.dataset.historyId)[0].getAttribute('aria-pressed'),undefined);f.head.children.find(node=>node.getAttribute('aria-label')==='选择历史素材').click();const tiles=f.find(node=>node.dataset.historyId);tiles[0].focus();tiles[0].click();assert.equal(f.document.activeElement.dataset.historyId,'first:0');assert.equal(tiles[0].getAttribute('aria-pressed'),'true');assert.equal(tiles[0].children.filter(node=>node.className==='generation-history-check'&&!node.hidden).length,1);f.find(node=>node.dataset.historyId==='second:0')[0].click();
  await f.find(node=>node.getAttribute('aria-label')==='应用到画布')[0].click();await tick();assert.deepEqual(f.applied,[['first:0','second:0']]);assert.equal(f.find(node=>node.dataset.historyId)[0].getAttribute('aria-pressed'),undefined);
  await f.find(node=>node.getAttribute('aria-label')==='预览：same prompt')[0].click();assert.deepEqual(f.previewed,['first:0']);f.dispose();assert.equal(f.listeners.size,0);
});
test('late thumbnails cannot render rows from the previous tab or after destruction',async()=>{
  const thumbnails=[];const f=await setup({rows:[row('image:0'),row('video:0','video')],thumbnail:row=>new Promise(resolve=>thumbnails.push({row,resolve}))});
  const videoTab=f.find(node=>node.dataset.type==='video')[0];videoTab.click();assert.equal(videoTab.getAttribute('aria-selected'),'true');assert.deepEqual(f.find(node=>node.dataset.historyId).map(node=>node.dataset.historyId),['video:0']);
  thumbnails[0].resolve('blob:old-image');await tick();assert.equal(f.find(node=>node.tagName==='img').length,0);f.dispose();for(const pending of thumbnails)pending.resolve('blob:late');await tick();assert.equal(f.find(node=>node.tagName==='img').length,0);
});
test('search, category keyboard navigation and multiselect download use only current real rows',async()=>{
  const f=await setup({rows:[row('video:0','video'),row('audio:0','audio')]});const imageTab=f.find(node=>node.dataset.type==='image')[0];imageTab.onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(f.document.activeElement.dataset.type,'video');
  const search=f.find(node=>node.tagName==='input')[0];search.value='missing';search.oninput();assert.equal(f.find(node=>node.dataset.historyId).length,0);search.value='same';search.oninput();
  f.head.children.find(node=>node.getAttribute('aria-label')==='选择历史素材').click();f.find(node=>node.dataset.historyId)[0].click();await f.find(node=>node.getAttribute('aria-label')==='下载')[0].click();assert.deepEqual(f.downloads,[['video:0']]);f.dispose();
});
test('idle storage notifications and selection reuse visible row DOM and resolve each thumbnail once',async()=>{
  let thumbnails=0;const f=await setup({thumbnail:async()=>{thumbnails++;return 'blob:actual';}});await tick();const first=f.find(node=>node.dataset.historyId==='first:0')[0],image=first.children[0];
  for(const listener of f.listeners)listener();for(const listener of f.listeners)listener();assert.equal(f.find(node=>node.dataset.historyId==='first:0')[0],first);assert.equal(first.children[0],image);assert.equal(thumbnails,2);
  f.head.children.find(node=>node.getAttribute('aria-label')==='选择历史素材').click();assert.equal(f.find(node=>node.dataset.historyId==='first:0')[0],first);assert.equal(first.children[0],image);assert.equal(thumbnails,2);f.dispose();
});
test('preview keeps its source button connected and focused for the media viewer return path',async()=>{
  const f=await setup(),source=f.find(node=>node.getAttribute('aria-label')==='预览：same prompt')[0];f.history.preview=async()=>{assert.equal(f.document.activeElement,source);assert.equal(source.isConnected,true);};
  await source.click();assert.equal(f.find(node=>node.getAttribute('aria-label')==='预览：same prompt')[0],source);assert.equal(f.document.activeElement,source);f.dispose();
});
function intersection(){let instance;const previous=global.IntersectionObserver;global.IntersectionObserver=class{constructor(callback,options){instance=this;this.callback=callback;this.options=options;this.observed=new Set();}observe(tile){this.observed.add(tile);}unobserve(tile){this.observed.delete(tile);}disconnect(){this.disconnected=true;this.observed.clear();}show(tile,shown=true){this.callback([{target:tile,isIntersecting:shown}]);}};return {get observer(){return instance;},restore(){global.IntersectionObserver=previous;}};}
test('long history lists acquire only visible thumbnails, idle events do not reload, and leaving/search/close release leases',async()=>{
  const io=intersection();let reads=0,released=0;try{const f=await setup({rows:Array.from({length:600},(_,index)=>row('row-'+index+':0')),acquireThumbnail:()=>{reads++;return {source:Promise.resolve('blob:visible-'+reads),release(){released++;}};}}),tiles=f.find(node=>node.dataset.historyId);assert.equal(tiles.length,600);assert.equal(reads,0);assert.equal(io.observer.options.rootMargin,'200px');
    io.observer.show(tiles[10]);io.observer.show(tiles[11]);await tick();const image=tiles[10].children[0];assert.equal(reads,2);for(let index=0;index<40;index++)for(const listener of f.listeners)listener();assert.equal(reads,2);assert.equal(tiles[10].children[0],image);
    io.observer.show(tiles[10],false);assert.equal(released,1);assert.equal(image.src,'');const search=f.find(node=>node.tagName==='input')[0];search.value='not-matching';search.oninput();assert.equal(released,2);assert.equal(io.observer.observed.size,0);f.dispose();assert.equal(io.observer.disconnected,true);assert.equal(released,2);
  }finally{io.restore();}
});
test('visibility leases are canceled on tab switch/destruction and late resolutions never reattach images',async()=>{
  const io=intersection();const pending=[];let released=0;try{const f=await setup({rows:[row('image:0'),row('video:0','video')],acquireThumbnail:()=>({source:new Promise(resolve=>pending.push(resolve)),release(){released++;}})});io.observer.show(f.find(node=>node.dataset.historyId)[0]);f.find(node=>node.dataset.type==='video')[0].click();assert.equal(released,1);io.observer.show(f.find(node=>node.dataset.historyId)[0]);f.dispose();assert.equal(released,2);for(const finish of pending)finish('blob:late');await tick();assert.equal(f.find(node=>node.tagName==='img').length,0);assert.equal(io.observer.disconnected,true);
  }finally{io.restore();}
});
