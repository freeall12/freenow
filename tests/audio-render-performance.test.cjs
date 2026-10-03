const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture({count=2000,audioCount=200,indexed=true}={}){
 const metrics={ids:0,globalQueries:0,bodyQueries:0,created:0,disposed:0,replacements:0},players=new Map(),shells=new Map();
 class Element{
  constructor(cls=''){this.className=cls;this.children=[];this.connected=true;}
  get isConnected(){return this.connected&&(this.parentNode?this.parentNode.isConnected:true);}
  append(...items){for(const item of items){item.parentNode=this;item.connected=true;this.children.push(item);}}
  contains(item){return this.children.includes(item)||this.children.some(child=>child.contains(item));}
  replaceChildren(...items){metrics.replacements++;for(const item of this.children){item.parentNode=null;item.connected=false;}this.children=[];this.append(...items);}
  querySelector(selector){if(selector==='.node-body')metrics.bodyQueries++;return this.children.find(item=>item.className.split(' ').includes(selector.slice(1)))||null;}
 }
 const nodes=Array.from({length:count},(_,i)=>{const id='n'+i;return {get id(){metrics.ids++;return id;},type:i>=count-audioCount?'audio':'image',audio:i>=count-audioCount?'/'+id+'.wav':undefined};});
 for(const n of nodes.filter(n=>n.type==='audio')){const shell=new Element(),body=new Element('node-body');shell.append(body);shells.set(n.id,shell);}
 const state={nodes,selected:[]},app={getState:()=>state};if(indexed)app.getNodeElement=id=>shells.get(id);
 const context={app,players,Map,WeakMap,current:null,panel:{},$:(selector)=>{metrics.globalQueries++;return shells.get(selector.match(/data-id="([^"]+)"/)[1])?.querySelector('.node-body');},makePlayer(src,id){metrics.created++;return {wrap:new Element('audio-player'),src,id,dispose(){metrics.disposed++;}};},button:()=>new Element(),el:(_tag,cls)=>new Element(cls),icon:()=>'',upload(){},closePop(){},position(){}};
 vm.createContext(context);const source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' const audioBodies='),end=source.indexOf(' window.GenerationAPI.subscribe',start);assert.ok(start>=0&&end>start);vm.runInContext('let resourceDisplay;'+source.slice(source.indexOf(' const pendingOriginalAudio='),source.indexOf('\n',source.indexOf(' const pendingOriginalAudio=')))+source.slice(start,end),context);
 const reset=()=>Object.keys(metrics).forEach(key=>metrics[key]=0);context.render();reset();
 return{state,players,shells,Element,metrics,reset,render:detail=>context.render({detail}),reconcile:()=>context.reconcilePlayers(state)};
}
test('audio player reconciliation is linear and reuses indexed bodies during node movement',()=>{
 const f=fixture(),original=[...f.players.values()];f.render();
 assert.ok(f.metrics.ids<3000,`expected linear graph reads, got ${f.metrics.ids}`);assert.equal(f.metrics.globalQueries,0);assert.equal(f.metrics.bodyQueries,0);
 assert.equal(f.metrics.created,0);assert.equal(f.metrics.disposed,0);assert.equal(f.metrics.replacements,0);assert.deepEqual([...f.players.values()],original);
 f.reset();f.render({viewportOnly:true});assert.deepEqual(f.metrics,{ids:0,globalQueries:0,bodyQueries:0,created:0,disposed:0,replacements:0});
});
test('changed sources, deleted nodes, replaced shells/bodies and removed players still invalidate',()=>{
 const f=fixture({count:4,audioCount:4}),old=f.players.get('n0');f.state.nodes[0].audio='/replacement.wav';f.render();assert.notEqual(f.players.get('n0'),old);assert.equal(f.metrics.disposed,1);assert.equal(f.metrics.created,1);
 f.reset();f.state.nodes.splice(1,1);f.render();assert.equal(f.players.has('n1'),false);assert.equal(f.metrics.disposed,1);
 f.reset();const shell=f.shells.get('n2');shell.replaceChildren(new f.Element('node-body'));f.render();assert.equal(f.metrics.disposed,1);assert.equal(f.metrics.created,1);assert.equal(f.metrics.bodyQueries,1);
 f.reset();const replacement=new f.Element();replacement.append(new f.Element('node-body'));f.shells.set('n3',replacement);f.render();assert.equal(f.metrics.disposed,1);assert.equal(f.metrics.created,1);
 f.reset();f.shells.get('n0').querySelector('.node-body').replaceChildren();f.render();assert.equal(f.metrics.disposed,1);assert.equal(f.metrics.created,1);
});
test('query fallback resolves each audio body once and empty/upload transitions keep controls',()=>{
 const f=fixture({count:10,audioCount:3,indexed:false});f.render();assert.equal(f.metrics.globalQueries,3);assert.equal(f.metrics.created,0);
 const n=f.state.nodes[7];n.audio=null;f.reset();f.render();assert.equal(f.metrics.disposed,1);assert.equal(f.players.has(n.id),false);const body=f.shells.get(n.id).querySelector('.node-body'),empty=body.querySelector('.audio-empty');assert.ok(empty);
 f.reset();f.render();assert.equal(body.querySelector('.audio-empty'),empty);assert.equal(f.metrics.replacements,0);
 n.audio='/uploaded.wav';f.reset();f.render();assert.equal(f.metrics.created,1);assert.ok(body.querySelector('.audio-player'));assert.ok(body.querySelector('.audio-replace'));
});
test('node index preserves the original find-first behavior for duplicate IDs',()=>{
 const f=fixture({count:1,audioCount:1}),original=f.players.get('n0');f.state.nodes.push({id:'n0',type:'audio',audio:'/later-duplicate.wav'});f.render();assert.equal(f.players.get('n0'),original);assert.equal(f.metrics.disposed,0);assert.equal(f.metrics.created,0);
});
test('old audio replaces its player with a stable repair control and local undo/redo recreates only that player',()=>{
 const f=fixture({count:2,audioCount:2}),other=f.players.get('n1');
 f.state.nodes[0].audio='https://files.tapnow.media/old.wav';f.render();
 assert.equal(f.players.has('n0'),false);assert.equal(f.players.get('n1'),other);assert.equal(f.metrics.disposed,1);assert.equal(f.metrics.created,0);
 const body=f.shells.get('n0').querySelector('.node-body'),control=body.querySelector('.audio-source-repair');assert.ok(control);
 f.reset();f.render();assert.equal(body.querySelector('.audio-source-repair'),control);assert.equal(f.metrics.replacements,0);
 f.state.nodes[0].audio='asset:repaired';f.render();assert.ok(f.players.has('n0'));assert.equal(f.players.get('n1'),other);assert.equal(f.metrics.created,1);
 f.state.nodes[0].audio='https://files.tapnow.media/old.wav';f.render();assert.equal(f.players.has('n0'),false);assert.ok(body.querySelector('.audio-source-repair'));
});
