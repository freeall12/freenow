const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),core=require('../canvas-playlist.js');
function fixture({videoCount=0,script=fs.readFileSync(require.resolve('../canvas-playlist-ui.js'),'utf8')}={}){
 const metrics={serialized:0,serializedBytes:0,selectionReads:0,replacements:0},handlers=new Map();
 class Element{
  constructor(tag,cls=''){this.tagName=tag;this.className=cls;this.children=[];this.attributes={};this.dataset={};this.style={};this.classList={add:name=>{if(!this.className.split(' ').includes(name))this.className+=' '+name;},toggle:(name,on)=>{this.className=this.className.split(' ').filter(v=>v&&v!==name).concat(on?[name]:[]).join(' ');}};}
  append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}set innerHTML(value){this.html=value;this.replaceChildren();}get innerHTML(){return this.html;}
  replaceChildren(...items){metrics.replacements++;this.children.forEach(item=>item.parentNode=null);this.children=[];this.append(...items);}remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(selector.startsWith('.')&&child.className.split(' ').includes(selector.slice(1))||selector==='input'&&child.tagName==='input')result.push(child);result.push(...child.querySelectorAll(selector));}return result;}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(){}setPointerCapture(id){this.pointer=id;}getBoundingClientRect(){return{left:0,top:0,width:960,height:104};}
 }
 const clip=(id,duration=4)=>({id,url:'data:video/mp4;base64,'+'a'.repeat(32000),poster:'data:image/png;base64,'+'b'.repeat(16000),title:id,sourceId:'source-'+id,sourceDuration:12,trimStart:0,duration});
 const playlist={id:'p',type:'playlist',title:'剪辑时间线',x:53284.3125,y:-1800.875,width:960,height:104,clips:[clip('a'),clip('b',3)]};
 const nodes=[playlist,...Array.from({length:videoCount},(_,i)=>({id:'v'+i,type:'video',video:'/video-'+i+'.mp4'}))],state={nodes,selected:[],view:{x:.125,y:.375,scale:.7}},owners=new Map();
 function shell(){const node=new Element('section');node.append(new Element('div','node-title'),new Element('div','node-body'),new Element('div','port'));return node;}
 for(const node of nodes)owners.set(node.id,shell());
 const body=new Element('body'),canvas=new Element('main'),bar=new Element('div'),document={body,createElement:tag=>new Element(tag),createTextNode:text=>new Element('#text'),addEventListener:(type,handler)=>handlers.set(type,handler),querySelector(selector){if(selector==='#canvas')return canvas;if(selector==='#node-toolbar')return bar;return owners.get(selector.match(/data-id="([^"]+)"/)?.[1]);}};
 const app={getState:()=>state,getNodeElement:id=>owners.get(id),render:()=>handlers.get('canvas:render')?.({}),updateNode(id,patch){Object.assign(nodes.find(n=>n.id===id),patch);this.render();}},window={CanvasApp:app,CanvasPlaylistCore:core,CANVAS_COMMAND_ICONS:{},UI_ICONS:{},addEventListener(){}};
 const localJSON={...JSON,stringify(value){metrics.serialized++;const text=JSON.stringify(value);metrics.serializedBytes+=text.length;return text;}};
 vm.runInNewContext(script,{window,document,JSON:localJSON,Map,Set,WeakMap,Object,innerWidth:1600,innerHeight:900});
 const reset=()=>Object.keys(metrics).forEach(k=>metrics[k]=0);reset();
 return{state,playlist,owners,bar,metrics,reset,shell,render:()=>app.render(),api:window.CanvasPlaylist,body:()=>owners.get('p').querySelector('.node-body'),tile:()=>owners.get('p').querySelector('.playlist-clip'),selectAllVideos(){state.selected=new Proxy(nodes.filter(n=>n.type==='video').map(n=>n.id),{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))metrics.selectionReads++;return Reflect.get(target,key,receiver);}});}};
}
test('playlist movement preserves clip DOM without serializing long media strings',()=>{
 const f=fixture(),tile=f.tile(),body=f.body();for(let i=0;i<90;i++){f.playlist.x+=.125;f.render();}
 assert.equal(f.metrics.serialized,0);assert.equal(f.metrics.serializedBytes,0);assert.equal(f.metrics.replacements,0);assert.equal(f.tile(),tile);assert.equal(f.body(),body);
 f.playlist.clips=f.playlist.clips.map(clip=>({...clip}));f.render();assert.equal(f.tile(),tile,'undo-like equal replacements keep the same clip DOM');
});
test('all clip fields, order, title and replaced bodies invalidate the timeline',()=>{
 for(const [field,value]of Object.entries({id:'changed',url:'/changed.mp4',poster:'/changed.png',title:'Renamed',sourceId:'new-source',sourceDuration:13,trimStart:1,duration:5})){
  const f=fixture(),tile=f.tile();f.playlist.clips[0][field]=value;f.render();assert.notEqual(f.tile(),tile,field);
 }
 const f=fixture();f.playlist.clips.reverse();f.render();assert.equal(f.tile().dataset.clipId,'b');
 f.playlist.title='新时间线';f.render();assert.equal(f.owners.get('p').querySelector('input').value,'新时间线');
 const old=f.body();f.owners.set('p',f.shell());f.render();assert.notEqual(f.body(),old);assert.equal(f.tile().dataset.clipId,'b');
});
test('cancelled trim discards preview width and rebuilds from saved clip values',()=>{
 const f=fixture(),tile=f.tile(),handle=tile.querySelector('.playlist-trim-handle');
 handle.onpointerdown({preventDefault(){},stopPropagation(){},pointerId:1,clientX:100});handle.onpointermove({clientX:111.2});assert.notEqual(tile.style.width,'64px');handle.onpointercancel();assert.equal(f.tile().style.width,'64px');assert.equal(f.playlist.clips[0].trimStart,0);assert.equal(f.playlist.clips[0].duration,4);
});
test('large multi-selection scans selected IDs once and still offers ordered video timeline creation',()=>{
 const f=fixture({videoCount:2000});f.selectAllVideos();f.reset();f.render();assert.equal(f.metrics.selectionReads,2000);assert.ok(f.bar.querySelector('.create-playlist'));assert.equal(f.metrics.serialized,0);
 f.bar.replaceChildren();f.state.selected.push('p');f.reset();f.render();assert.equal(f.bar.querySelector('.create-playlist'),null,'mixed playlist/video selection remains ineligible');
});
