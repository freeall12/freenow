const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

async function fixture({count=0}={}){
 const imageCore=await import('../image-history-core.mjs'),videoCore=await import('../src/features/video-history/core.mjs'),versionsCore=await import('../image-versions-core.mjs');
 const counts={queries:0,attributes:0,text:0,clones:0,jobs:0,created:0},handlers=new Map(),owners=new Map(),favorites=new Set();
 class Element{
  constructor(tag){counts.created++;this.tagName=tag;this.children=[];this.parentNode=null;this.className='';this.dataset={};this.style={};this.attributes=new Map();this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(x=>!names.includes(x)).join(' ');},contains:name=>this.className.split(' ').includes(name),toggle:(name,on)=>{if(on===undefined)on=!this.classList.contains(name);on?this.classList.add(name):this.classList.remove(name);}};}
  set textContent(value){counts.text++;this._text=String(value);}get textContent(){return this._text||'';}
  setAttribute(key,value){counts.attributes++;this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key);}
  removeAttribute(key){this.attributes.delete(key);}
  append(...items){for(const item of items){item.remove();item.parentNode=this;this.children.push(item);}}
  prepend(...items){for(const item of items.toReversed()){item.remove();item.parentNode=this;this.children.unshift(item);}}
  remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  replaceChildren(...items){for(const item of this.children)item.parentNode=null;this.children=[];this.append(...items);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){counts.queries++;const parts=selector.split(',');const matches=(item,part)=>part.startsWith('.')?item.classList.contains(part.slice(1)):part==='[role=tab]'?item.getAttribute('role')==='tab':item.tagName===part;const all=[];const visit=item=>{for(const child of item.children){all.push(child);visit(child);}};visit(this);return all.filter(item=>parts.some(raw=>{const scoped=raw.trim().startsWith(':scope');const part=raw.trim().replace(/^:scope\s*>\s*/,'');return (!scoped||item.parentNode===this)&&matches(item,part);}));}
  get firstChild(){return this.children[0];}get isConnected(){return !!this.root||!!this.parentNode?.isConnected;}
  getAnimations(){return [];}animate(){return {finished:Promise.resolve(),cancel(){}};}focus(){}pause(){}load(){}play(){return Promise.resolve();}
 }
 const document={head:new Element('head'),body:Object.assign(new Element('body'),{root:true}),hidden:false,createElement:tag=>new Element(tag),addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},dispatchEvent(event){for(const fn of handlers.get(event.type)||[])fn(event);}};
 const state={nodes:[],selected:[],view:{x:0,y:0,scale:1}},jobs=[];
 const library={isFavorite:n=>favorites.has(n.id),toggleFavorite(n){favorites.has(n.id)?favorites.delete(n.id):favorites.add(n.id);}};
 const app={getState:()=>state,getNodeElement:id=>owners.get(id),render(){document.dispatchEvent({type:'canvas:render'});},select(id){state.selected=[id];this.render();},notify(message){throw Error(message);},updateNode(id,patch){Object.assign(state.nodes.find(n=>n.id===id),patch);this.render();}};
 const window={CanvasApp:app,CanvasLibrary:library,VERSION_DATA:{},GenerationAPI:{getJobs(){counts.jobs++;return jobs;}},NodeEditor:{getConfig:n=>n.generation||{},invalidate(){},closePopover(){}},NodeActions:{close(){},closePop(){}},LocalAssets:{url:async value=>value}};
 const context=vm.createContext({...await import('../src/features/local-resource-migration/display-media.mjs'),icons:(await import('../src/features/video-history/icons.mjs')).default,window,document,CanvasLibrary:library,LocalAssets:window.LocalAssets,localStorage:{getItem(){return null;},setItem(){}},matchMedia:()=>({matches:true}),structuredClone:value=>{counts.clones++;return structuredClone(value);},queueMicrotask,Event:class{constructor(type){this.type=type;}},CSS:{escape:value=>value},console});
 function add(n){state.nodes.push(n);const owner=new Element('div');owner.dataset.id=n.id;const body=new Element('div');body.className='node-body';owner.append(body);document.body.append(owner);owners.set(n.id,owner);return owner;}
 for(let i=0;i<count;i++)add({id:'n'+i,type:i%2?'image':'video',image:i%2?'/main.png':null,video:i%2?null:'/main.mp4',x:i*600+.125,y:.375,width:435,height:250});
 function load(name,core){let source=fs.readFileSync(path.join(__dirname,'..',name),'utf8');source=source.replace(/^import .*;\n/gm,'').replace('export function historySummary','function historySummary').replace("new URL('./styles.css',import.meta.url).href","'src/features/video-history/styles.css'");const code=`(function(core,history,src,closed,spring){${source}\nif(typeof historySummary==='function')globalThis.historySummary=historySummary;})`;
 const fn=vm.runInContext(code,context);fn(core,imageCore,versionsCore.src,versionsCore.closed,versionsCore.spring);}
 load('image-history-ui.mjs',imageCore);load('image-versions-ui.mjs',versionsCore);load('src/features/video-history/ui.mjs',videoCore);
 return {state,app,window,document,owners,counts,context,jobs,favorites,add,Element,reset(){for(const key in counts)counts[key]=0;},snapshot(){return JSON.stringify([...owners].map(([id,owner])=>[id,owner.children.map(n=>({className:n.className,attributes:[...n.attributes],children:n.children.map(c=>({className:c.className,attributes:[...c.attributes],text:c.firstChild?.textContent}))}))]));}};
}

test('complete history listeners avoid repeated empty cleanup and preserve in-place content, busy and favorite updates',async()=>{
 const f=await fixture({count:500});f.reset();for(let i=0;i<120;i++)f.app.render();assert.equal(f.counts.queries,0);assert.equal(f.counts.attributes,0);assert.equal(f.counts.clones,0);
 const image=f.state.nodes[1],video=f.state.nodes[0];image.imageHistory=[{options:['/a.png',{url:'/b.png'},null]}];video.videoHistory=[{options:['/a.mp4',{url:'/b.mp4'},null]}];f.app.render();
 const imageOwner=f.owners.get(image.id),videoOwner=f.owners.get(video.id),imageCount=imageOwner.querySelector('.image-history-count'),videoCount=videoOwner.querySelector('.video-history-count');assert.equal(imageCount.firstChild.textContent,'3');assert.equal(videoCount.firstChild.textContent,'2');
 f.reset();for(let i=0;i<20;i++)f.app.render();assert.equal(f.counts.queries,0);assert.equal(f.counts.attributes,0);assert.equal(f.counts.clones,0);assert.equal(f.counts.jobs,20);
 image.imageHistory[0].options.push('/c.png');video.videoHistory[0].options.push('/c.mp4');f.favorites.add(image.id);f.jobs.push({request:{nodeId:image.id,kind:'image.generate'},status:'running'});f.app.render();
 assert.equal(imageCount.firstChild.textContent,'4');assert.equal(videoCount.firstChild.textContent,'3');assert.equal(imageCount.disabled,true);assert.equal(imageOwner.querySelector('.image-history-star').getAttribute('aria-pressed'),'true');assert.equal(videoOwner.querySelectorAll(':scope>.video-history-stack').length,2);
 f.jobs.length=0;image.imageHistory.length=0;video.videoHistory.length=0;f.app.render();assert.equal(imageOwner.querySelector('.image-history-controls'),null);assert.equal(videoOwner.querySelector('.video-history-count'),null);
 image.versions=[{image:'/a.png'},{image:'/b.png'}];f.app.render();const legacy=imageOwner.querySelector('.version-count');assert.equal(legacy.firstChild.textContent,'2');image.pendingOperation={};f.app.render();assert.equal(legacy.disabled,true);image.pendingOperation=null;f.app.render();assert.equal(legacy.disabled,false);
 // Controls removed by a node rebuild must be mounted again, even with unchanged data.
 imageOwner.replaceChildren();f.app.render();assert.notEqual(imageOwner.querySelector('.version-count'),legacy);
});

test('selected history stacks survive fractional movement and open/close/batch interactions still refresh media',async()=>{
 const f=await fixture(),image={id:'image',type:'image',image:'/a.png',x:53284.3,y:-2180.48,width:435,height:250,imageHistory:[{options:[{image:'/a.png',width:435,height:250},{image:'/b.png',width:435,height:250}]},{options:[{image:'/c.png',width:250,height:435}]}]},video={id:'video',type:'video',video:'/a.mp4',x:1,y:2,width:435,height:250,videoHistory:[{options:[{video:'/a.mp4',width:435,height:250},{video:'/b.mp4',width:435,height:250}]},{options:[{video:'/c.mp4',width:250,height:435}]}]};
 const imageOwner=f.add(image),videoOwner=f.add(video);f.app.select(image.id);const stacks=imageOwner.querySelectorAll(':scope>.image-history-stack');assert.equal(stacks.length,2);f.reset();for(let i=0;i<30;i++){image.x+=.125;image.y-=.375;f.app.render();}assert.equal(f.counts.created,0);assert.deepEqual(imageOwner.querySelectorAll(':scope>.image-history-stack'),stacks);
 f.window.ImageHistory.open(image.id);assert.equal(f.window.ImageHistory.activeId,image.id);assert.equal(imageOwner.querySelectorAll('.image-history-card').length,2);const imageTabs=imageOwner.querySelectorAll('[role=tab]');await imageTabs[1].onclick({stopPropagation(){}});assert.equal(imageOwner.querySelectorAll('.image-history-card').length,1);f.window.ImageHistory.close();assert.equal(f.window.ImageHistory.activeId,undefined);
 f.window.VideoHistory.open(video.id);assert.equal(f.window.VideoHistory.activeId,video.id);assert.equal(videoOwner.querySelectorAll('.video-history-card').length,2);await videoOwner.querySelectorAll('[role=tab]')[1].onclick({stopPropagation(){}});assert.equal(videoOwner.querySelectorAll('.video-history-card').length,1);f.window.VideoHistory.close();assert.equal(f.window.VideoHistory.activeId,undefined);assert.equal(videoOwner.querySelectorAll(':scope>.video-history-stack').length,2);
});

module.exports={fixture};


test('closed legacy versions scan live media without serializing metadata and retain current gallery guards',async()=>{
 const f=await fixture(),n={id:'versions',type:'image',image:'/main.png',width:435,height:250,x:123.125,y:-12.375};
 let metadataReads=0;const alternative={image:'/a.png',sourceFileId:'first',label:'first',get metadata(){metadataReads++;return {nested:'original'};}};
 n.versions=['/main.png',alternative,{image:'/a.png'},null,{fullImage:'/b.png',image:'/thumb.png'}];const owner=f.add(n);f.app.render();
 const count=owner.querySelector('.version-count'),stacks=owner.querySelectorAll(':scope>.image-version-stack');assert.equal(count.firstChild.textContent,'3');assert.equal(stacks.length,2);
 f.reset();metadataReads=0;for(let frame=0;frame<90;frame++){n.x+=.125;f.window.ImageVersions.render();}
 assert.equal(metadataReads,0);assert.equal(f.counts.created,0);assert.equal(f.counts.attributes,0);assert.deepEqual(owner.querySelectorAll(':scope>.image-version-stack'),stacks);
 alternative.image='/main.png';f.app.render();assert.equal(count.firstChild.textContent,'3');
 n.versions.splice(2,1);f.app.render();assert.equal(count.firstChild.textContent,'2');assert.equal(owner.querySelectorAll(':scope>.image-version-stack').length,1);
 n.width=435.25;f.app.render();assert.match(owner.querySelector('.image-version-stack').style.cssText,/width:435.25px/);
 n.pendingOperation={};f.app.render();assert.equal(owner.querySelectorAll(':scope>.image-version-stack').length,0);assert.equal(count.disabled,true);n.pendingOperation=null;f.app.render();assert.equal(owner.querySelectorAll(':scope>.image-version-stack').length,1);
 // Explicit empty arrays suppress fallback; deleting the field restores it.
 f.window.VERSION_DATA[n.id]=['/main.png','/fallback.png'];n.versions=[];f.app.render();assert.equal(owner.querySelector('.version-count'),null);delete n.versions;f.app.render();assert.equal(owner.querySelector('.version-count').firstChild.textContent,'2');
 f.window.VERSION_DATA[n.id][1]='/main.png';f.app.render();assert.equal(owner.querySelector('.version-count').firstChild.textContent,'1');
 n.versions=['/main.png',{image:'/a.png',label:'first',sourceFileId:'first',metadata:{nested:'original'}}];f.app.render();
 for(const mutate of [()=>n.versions[1].label='edited',()=>n.versions[1].sourceFileId='edited',()=>n.versions[1].metadata.nested='edited']){
  f.window.ImageVersions.open(n.id);assert.equal(f.window.ImageVersions.activeId,n.id);mutate();f.app.render();assert.equal(f.window.ImageVersions.activeId,undefined);
 }
 f.window.ImageVersions.open(n.id);owner.querySelector('.image-version-card').onclick({stopPropagation(){}});assert.equal(n.image,'/a.png');assert.equal(n.currentSourceFileId,'edited');
 const restored=new f.Element('div');f.document.body.append(restored);owner.remove();f.owners.set(n.id,restored);f.app.render();assert.equal(restored.querySelector('.version-count').firstChild.textContent,'2');assert.equal(restored.querySelectorAll(':scope>.image-version-stack').length,1);
 n.imageHistory=[{options:['/history.png']}];f.app.render();assert.equal(restored.querySelector('.version-count'),null);n.imageHistory=[];f.app.render();assert.equal(restored.querySelector('.version-count').firstChild.textContent,'2');
});

function countImageStackSignatures(f){
 const counts={calls:0,characters:0};
 f.context.JSON=Object.assign(Object.create(JSON),{stringify(value,...args){const text=JSON.stringify(value,...args);if(Array.isArray(value)&&value.length===7&&typeof value[0]==='string'&&Array.isArray(value[1])){counts.calls++;counts.characters+=text.length;}return text;}});
 return counts;
}

test('unselected image histories avoid deep stack serialization while counts, favorites and in-place mutations remain live',async()=>{
 const f=await fixture(),serialized=countImageStackSignatures(f);let metadataReads=0;
 const nodes=Array.from({length:200},(_,i)=>({id:'history-'+i,type:'image',image:'/main-'+i+'.png',x:i*500+.125,y:-23.375,width:435,height:250,generation:{prompt:'长中文分镜提示词'.repeat(1024)},imageHistory:[{options:[{image:'/main-'+i+'.png',width:435,height:250},{image:'/alt-'+i+'.png',width:435,height:250,get metadata(){metadataReads++;return{nested:'保留元数据'};}}]}]}));
 nodes.forEach(f.add);f.app.render();f.reset();metadataReads=0;
 for(let frame=0;frame<90;frame++){nodes[0].x+=.125;f.app.render();}
 assert.equal(serialized.calls,0);assert.equal(serialized.characters,0);assert.equal(metadataReads,0);assert.equal(f.counts.queries,0);assert.equal(f.counts.created,0);
 const n=nodes[7],owner=f.owners.get(n.id),count=owner.querySelector('.image-history-count');
 n.imageHistory[0].options.push({image:'/new.png',width:250,height:435});n.generation.prompt='原地修改提示词';f.favorites.add(n.id);f.app.render();
 assert.equal(count.firstChild.textContent,'3');assert.equal(owner.querySelector('.image-history-star').getAttribute('aria-pressed'),'true');assert.equal(serialized.calls,0);
 f.app.select(n.id);assert.equal(owner.querySelectorAll(':scope>.image-history-stack').length,2);assert.ok(serialized.calls>0);assert.ok(metadataReads>0,'selected folded stacks still inspect live metadata');
 n.imageHistory[0].options.push({image:'/newest.png',width:300,height:250});f.app.render();assert.equal(owner.querySelectorAll(':scope>.image-history-stack').length,3);
 f.state.selected=[];f.app.render();serialized.calls=0;metadataReads=0;for(let i=0;i<10;i++)f.app.render();assert.equal(owner.querySelectorAll(':scope>.image-history-stack').length,0);assert.equal(serialized.calls,0);assert.equal(metadataReads,0);
 f.app.select(n.id);assert.equal(owner.querySelectorAll(':scope>.image-history-stack').length,3,'reselection reconstructs the current history');
});

test('busy and expanded image histories skip only folded signatures and restore stacks after jobs and gallery close',async()=>{
 const f=await fixture(),serialized=countImageStackSignatures(f),n={id:'history',type:'image',image:'/a.png',x:53284.3125,y:-32.875,width:435.25,height:250.125,generation:{prompt:'原始'},imageHistory:[{options:[{image:'/a.png',width:435,height:250},{image:'/b.png',width:435,height:250}]}]},owner=f.add(n);
 f.app.select(n.id);const first=owner.querySelector('.image-history-stack');let cancelled=0;first.getAnimations=()=>[{cancel(){cancelled++;}}];
 f.jobs.push({request:{nodeId:n.id,kind:'image.generate'},status:'running'});f.app.render();assert.equal(cancelled,1);assert.equal(owner.querySelectorAll(':scope>.image-history-stack').length,0);serialized.calls=0;
 for(let i=0;i<20;i++)f.app.render();assert.equal(cancelled,1);assert.equal(serialized.calls,0);assert.equal(owner.querySelector('.image-history-count').disabled,true);
 n.imageHistory[0].options.push({image:'/c.png',width:435,height:250});f.app.render();assert.equal(owner.querySelector('.image-history-count').firstChild.textContent,'3');assert.equal(serialized.calls,0);
 f.jobs.length=0;f.app.render();assert.equal(owner.querySelector('.image-history-count').disabled,false);assert.equal(owner.querySelectorAll(':scope>.image-history-stack').length,2);
 n.pendingOperation='image.generate';f.app.render();serialized.calls=0;f.app.render();assert.equal(serialized.calls,0);delete n.pendingOperation;f.app.render();assert.equal(owner.querySelectorAll(':scope>.image-history-stack').length,2);
 f.window.ImageHistory.open(n.id);assert.equal(f.window.ImageHistory.activeId,n.id);serialized.calls=0;for(let i=0;i<10;i++)f.app.render();assert.equal(serialized.calls,0,'expanded gallery uses its own full signature guard only');
 n.generation.prompt='展开后原地修改';f.app.render();assert.equal(f.window.ImageHistory.activeId,undefined,'gallery stale-content guard remains active');assert.equal(owner.querySelectorAll(':scope>.image-history-stack').length,2);
 f.window.ImageHistory.open(n.id);f.window.ImageHistory.close();assert.equal(owner.querySelectorAll(':scope>.image-history-stack').length,2);assert.equal(n.x,53284.3125);assert.equal(n.y,-32.875);
 const restored=new f.Element('div'),body=new f.Element('div');body.className='node-body';restored.append(body);f.document.body.append(restored);owner.remove();f.owners.set(n.id,restored);f.state.selected=[];serialized.calls=0;f.app.render();assert.equal(serialized.calls,0);f.app.select(n.id);assert.equal(restored.querySelectorAll(':scope>.image-history-stack').length,2);
});
