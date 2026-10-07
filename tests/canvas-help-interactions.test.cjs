const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const modules=Promise.all([import('../src/features/canvas-help/ui.mjs'),import('../src/features/canvas-help/catalog.mjs')]);
async function fixture(t){
 const [{createCanvasHelp}]=await modules,dom=new JSDOM('<body><main id="canvas" tabindex="0"></main><button id="help">帮助</button><input id="outside"></body>',{url:'http://localhost:4195/'}),{window}=dom,{document}=window,calls=[],timers=new Map();let id=0,focused=true;
 document.hasFocus=()=>focused;window.setTimeout=fn=>{timers.set(++id,fn);return id;};window.clearTimeout=id=>timers.delete(id);
 const trigger=document.getElementById('help'),canvas=document.getElementById('canvas');trigger.getBoundingClientRect=()=>({left:268,top:660,width:40,height:40});canvas.getBoundingClientRect=()=>({left:0,top:0,width:740,height:720,bottom:720});
 const owner=createCanvasHelp({document,window,trigger,canvas,run:id=>calls.push(id)});t.after(()=>{owner.destroy();dom.window.close();});
 return {document,window,trigger,canvas,owner,calls,timers,get menu(){return document.getElementById('canvas-help-menu');},get rows(){return [...this.menu.querySelectorAll('[role=option]')];},key(key,options={}){const event=new window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key,...options});document.activeElement.dispatchEvent(event);return event;},pointer(target,type='pointerdown'){target.dispatchEvent(new window.MouseEvent(type,{bubbles:true}));},flush(){const next=[...timers.values()];timers.clear();next.forEach(fn=>fn());},loseWindowFocus(){focused=false;window.dispatchEvent(new window.Event('blur'));}};
}
test('help keyboard confirms visual hover target while arrows begin at real focus and escape returns trigger',async t=>{
 const f=await fixture(t);f.trigger.click();const rows=f.rows;assert.equal(f.document.activeElement,rows[0]);
 rows[2].dispatchEvent(new f.window.Event('pointerenter'));assert.equal(f.document.activeElement,rows[0]);assert.equal(rows[2].getAttribute('aria-selected'),'true');
 f.key('ArrowDown');assert.equal(f.document.activeElement,rows[1]);rows[2].dispatchEvent(new f.window.Event('pointerenter'));f.key('Enter');assert.deepEqual(f.calls,['agent']);assert.equal(f.menu,null);assert.equal(f.document.activeElement,f.trigger);
 f.trigger.click();f.key('End');assert.equal(f.document.activeElement,f.rows[4]);f.key('Escape');assert.equal(f.menu,null);assert.equal(f.document.activeElement,f.trigger);
});
test('second pointer click closes rather than reopening after delayed focusout; native Tab leaves external focus intact',async t=>{
 const f=await fixture(t);f.trigger.click();f.pointer(f.trigger);f.trigger.focus();f.flush();assert(f.menu);f.trigger.click();assert.equal(f.menu,null);
 f.trigger.click();assert.equal(f.key('Tab').defaultPrevented,false);f.rows[1].focus();assert(f.menu);const outside=f.document.getElementById('outside');outside.focus();f.flush();assert.equal(f.menu,null);assert.equal(f.document.activeElement,outside);
 f.trigger.click();f.trigger.focus();f.flush();assert.equal(f.menu,null,'Shift Tab back to trigger closes the menu');
});
test('IME, modified/repeated confirm and stale focus timers never run external actions',async t=>{
 const f=await fixture(t);f.trigger.click();for(const options of [{isComposing:true},{keyCode:229},{ctrlKey:true},{metaKey:true},{altKey:true},{repeat:true}])f.key('Enter',options);assert.deepEqual(f.calls,[]);assert(f.menu);
 f.key('Escape',{isComposing:true});assert(f.menu);f.owner.close();f.owner.open();f.flush();assert(f.menu);f.loseWindowFocus();assert.equal(f.menu,null);
});
test('shortcuts are a local nonmodal panel, upper dialogs own escape and outside dismissal preserves selection',async t=>{
 const f=await fixture(t),hiddenSwitcher=f.document.createElement('section');hiddenSwitcher.setAttribute('role','dialog');hiddenSwitcher.hidden=true;f.document.body.append(hiddenSwitcher);f.owner.shortcuts();const panel=f.document.getElementById('canvas-shortcut-panel');assert(panel);assert.equal(panel.querySelectorAll('h2').length,5);assert.equal(panel.querySelectorAll('.canvas-shortcut-row').length,21);assert.equal(panel.querySelectorAll('img').length,2);assert([...panel.querySelectorAll('img')].every(img=>img.src.startsWith('http://localhost:4195/')||img.src.startsWith('file:')));
 const modal=f.document.createElement('dialog');modal.setAttribute('open','');f.document.body.append(modal);assert.equal(f.key('Escape').defaultPrevented,false);assert(panel.isConnected);modal.remove();assert(f.key('Escape').defaultPrevented);assert(!panel.isConnected);assert.equal(f.document.activeElement,f.trigger);
 f.owner.shortcuts();f.canvas.focus();f.pointer(f.canvas);assert.equal(f.document.getElementById('canvas-shortcut-panel'),null);assert.equal(f.document.activeElement,f.canvas);assert.deepEqual(f.calls,[]);
});
test('actual entry uses local guide links and no original production service or branding resource',async()=>{
 const root=require('node:path').resolve(__dirname,'..'),entry=fs.readFileSync(root+'/src/features/canvas-help/entry.mjs','utf8'),guide=fs.readFileSync(root+'/src/features/canvas-help/guide-data.mjs','utf8');assert.match(entry,/new URL\('\.\/guide\.html'/);assert.match(entry,/ExternalAgentUI\.open/);assert.doesNotMatch(entry+guide,/https?:\/\/[^\s]*tapnow/);
 for(const [file,sha]of [['zoom.gif','5b550ed1fe4162c9a23c343fc77c39ecd192312fb86cb5743460c8894407d9b6'],['pan.gif','52d18a1dc24a9f3f286a936031fe4b99b3f24a54b5744eaa2973f4379ccb730a']]){const data=fs.readFileSync(root+'/src/features/canvas-help/assets/'+file);assert.equal(require('node:crypto').createHash('sha256').update(data).digest('hex'),sha);}
});
