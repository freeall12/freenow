const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const clipboard=require('../canvas-clipboard.js');
function target(scope='canvas'){
  return {closest(selector){if(selector==='[data-keyboard-scope]')return scope==='overlay'?{getAttribute:()=>scope}:null;
    if(selector.includes('input')&&scope==='text-editor')return this;
    if(selector.includes('button')&&scope==='external')return this;
    return null;}};
}
test('official keyboard scopes protect native fields, interactive controls and explicit overlays',()=>{
  const canvas={contains:t=>t.inCanvas!==false};
  assert.equal(clipboard.keyboardScope(target(),canvas),'canvas');
  for(const scope of ['text-editor','external','overlay'])assert.equal(clipboard.keyboardScope(target(scope),canvas),scope);
  assert.equal(clipboard.keyboardScope({...target(),inCanvas:false},canvas),'external');
  const active=target('text-editor'),body={};assert.equal(clipboard.eventTarget({target:body},{body,activeElement:active}),active);
  assert(clipboard.isComposing({key:'Process'}));assert(clipboard.isComposing({keyCode:229}));
});
test('clipboard items containing a file beat any internal graph marker',()=>{
  const image={name:'clipboard.png',type:'image/png'};
  assert.deepEqual(clipboard.clipboardFiles({files:[],items:[{kind:'file',getAsFile:()=>image},{kind:'string'}]}),[image]);
  assert.deepEqual(clipboard.clipboardFiles({files:[image],items:[]}),[image]);
});
function listeners(){
  const source=fs.readFileSync(require.resolve('../canvas-menus.js'),'utf8'),start=source.indexOf('  const canvasClipboardContext ='),end=source.indexOf("  $('#canvas').addEventListener('pointermove'",start);
  const callbacks={},calls=[],canvas={contains:t=>t.scope==='canvas'},body={matches:()=>false},document={body,activeElement:null,documentElement:{},querySelector:()=>null,addEventListener:(type,fn)=>callbacks[type]=fn};
  const window={CanvasClipboard:clipboard,getSelection:()=>({toString:()=>''}),CanvasCommands:{importFiles:files=>calls.push(['files',files])}};
  const context={window,document,$:()=>canvas,copied:{nodes:[{}]},app:{getState:()=>({selected:['a']}),notify:message=>calls.push(['error',message])},copy:()=>calls.push(['copy']),paste:()=>calls.push(['paste']),hideTip(){},safe:fn=>()=>fn()};
  vm.runInNewContext(source.slice(start,end),context);
  const event=(patch={})=>({target:{...target(),scope:'canvas'},key:'v',metaKey:true,preventDefault(){this.defaultPrevented=true;},...patch});
  return {callbacks,calls,event,window};
}
test('production key handlers preserve native paste and duplicate only once with valid ownership',()=>{
  const f=listeners(),paste=f.event();f.callbacks.keydown(paste);assert.equal(paste.defaultPrevented,undefined);assert.deepEqual(f.calls,[]);
  for(const patch of [{defaultPrevented:true},{isComposing:true},{repeat:true},{altKey:true},{shiftKey:true},{target:{...target('external'),scope:'external'}}])f.callbacks.keydown(f.event({key:'d',...patch}));
  assert.deepEqual(f.calls,[]);const duplicate=f.event({key:'d'});f.callbacks.keydown(duplicate);assert(duplicate.defaultPrevented);assert.deepEqual(f.calls,[['copy'],['paste']]);
});
test('production paste imports real files before graph and ignores previously handled events',()=>{
  const f=listeners(),image={name:'clipboard.png',type:'image/png'},data={files:[image],getData:()=> '__tapnow_internal_copy__'};
  const external=f.event({clipboardData:data});f.callbacks.paste(external);assert(external.defaultPrevented);assert.deepEqual(f.calls,[['files',[image]]]);
  f.callbacks.paste(f.event({clipboardData:data,defaultPrevented:true}));assert.equal(f.calls.length,1);
  const graph=f.event({clipboardData:{files:[],getData:()=> '__tapnow_internal_copy__'}});f.callbacks.paste(graph);assert(graph.defaultPrevented);assert.deepEqual(f.calls.at(-1),['paste']);
});
test('production native copy keeps selected document text',()=>{
  const f=listeners();f.window.getSelection=()=>({toString:()=> '正文选区'});const e=f.event({clipboardData:{setData(){throw Error('must remain native');}}});
  f.callbacks.copy(e);assert.equal(e.defaultPrevented,undefined);f.callbacks.keydown(f.event({key:'c'}));assert.deepEqual(f.calls,[]);
});
test('production media import keeps fractional world coordinates when viewport changes during decoding',async()=>{
  const source=fs.readFileSync(require.resolve('../canvas-commands.js'),'utf8'),start=source.indexOf(' async function importFiles('),end=source.indexOf(' async function upload(',start);
  const calls=[],view={x:-101.375,y:200.125,scale:.4},initial={...view},point={x:320.25,y:140.375};let release;
  const pending=new Promise(resolve=>release=resolve),app={getState:()=>({view}),addNode:(...args)=>calls.push(args),notify:assert.fail};
  const context={app,window:{LocalMedia:{asDataUrl:async()=>{await pending;return 'data:image/png;base64,AA';}}},center:()=>point};
  vm.runInNewContext(source.slice(start,end)+'\nthis.importFiles=importFiles;',context);
  const task=context.importFiles([{name:'a.png',type:'image/png'},{name:'b.png',type:'image/png'}],point);
  Object.assign(view,{x:50,y:-60,scale:1});release();await task;
  assert.equal(calls.length,2);assert.equal(calls[0][4].x,(point.x-initial.x)/initial.scale);assert.equal(calls[0][4].y,(point.y-initial.y)/initial.scale);
  assert.equal(calls[1][4].x,calls[0][4].x+40/initial.scale);assert.equal(calls[1][4].y,calls[0][4].y+40/initial.scale);
});
