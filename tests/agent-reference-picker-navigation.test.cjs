const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric'));
const canvasPath=fabricRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
let referenceData;test.before(async()=>{referenceData=await import('../src/features/agent-composer/reference-data.mjs');});
function fixture(){
 const dom=new JSDOM('<button id="anchor">参考</button><button id="outside">外部</button>',{pretendToBeVisual:true,runScripts:'outside-only'}),{window}=dom,context=dom.getInternalVMContext();
 window.matchMedia=()=>({matches:true});window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.animate=function(){return {finished:Promise.resolve()};};
 Object.assign(context,referenceData,{availableApps:()=>[],icons:{}});
 vm.runInContext(fs.readFileSync(require.resolve('../src/features/agent-composer/reference-picker.mjs'),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,''),context);
 const picks=[],cancels=[],anchor=window.document.getElementById('anchor');
 const control=window.createReferencePicker({anchor,getData:()=>({nodes:[],library:[{id:'p1',name:'雨夜参考',folder:'场景',scope:'personal',type:'text'},{id:'t1',name:'同名团队资产',folder:'场景',scope:'team',type:'text'}],folders:[]}),onPick:ref=>picks.push(ref),onCancel:focus=>{cancels.push(focus);if(focus)anchor.focus();}});
 const root=window.document.querySelector('.agent-reference-picker'),search=root.querySelector('input');
 return {window,anchor,picks,cancels,control,root,search,close:()=>window.close()};
}
const key=(f,value,extra={})=>{const event=new f.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra});f.search.dispatchEvent(event);return event;};
const query=(f,value)=>{f.search.value=value;f.search.dispatchEvent(new f.window.Event('input',{bubbles:true}));};
const selected=f=>f.root.querySelector('.selected');
const folder=(f,name)=>{query(f,name);f.root.querySelector('.agent-reference-row').click();};
test('empty folder exposes back and whole-folder reference as keyboard choices without submission',()=>{
 const f=fixture();try{folder(f,'角色');const rows=f.root.querySelectorAll('[data-selectable-index]');assert.equal(rows.length,2);assert.equal(rows[0].dataset.selectableIndex,'0');assert.equal(rows[1].dataset.selectableIndex,'1');assert.equal(selected(f),rows[0]);assert.equal(f.picks.length,0);key(f,'ArrowDown');assert.equal(selected(f),rows[1]);key(f,'Enter');assert.equal(f.picks.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.picks[0])),{kind:'folder',id:'角色',scope:'personal',label:'private:/角色'});}finally{f.close();}
});
test('nonempty folder offsets real asset and keeps personal/team scope distinct',()=>{
 const f=fixture();try{folder(f,'场景');const rows=f.root.querySelectorAll('[data-selectable-index]');assert.equal(rows.length,3);assert.equal(selected(f),rows[1]);key(f,'ArrowDown');assert.equal(selected(f),rows[2]);key(f,'Enter');assert.equal(f.picks[0].id,'p1');assert.equal(f.picks[0].scope,'personal');}finally{f.close();}
 const team=fixture();try{query(team,'场景');team.root.querySelectorAll('.agent-reference-row')[1].click();key(team,'Enter');assert.equal(team.picks[0].kind,'folder');assert.equal(team.picks[0].scope,'team');assert.equal(team.picks[0].label,'team:/场景');}finally{team.close();}
});
test('search rebuilds indices and back via Enter restores root selection and search focus',()=>{
 const f=fixture();try{folder(f,'场景');query(f,'missing');assert.equal(f.root.querySelectorAll('[data-selectable-index]').length,2);assert.equal(selected(f).dataset.selectableIndex,'0');key(f,'Enter');assert.equal(f.root.querySelector('.agent-reference-path'),null);assert.equal(f.search.value,'');assert.equal(f.window.document.activeElement,f.search);assert.equal(selected(f).dataset.selectableIndex,'0');assert.equal(f.picks.length,0);folder(f,'场景');query(f,'雨夜');assert.deepEqual([...f.root.querySelectorAll('[data-selectable-index]')].map(row=>row.dataset.selectableIndex),['0','1','2']);assert.equal(f.search.getAttribute('aria-activedescendant'),selected(f).id);}finally{f.close();}
});
test('folder Escape returns to root and only root Escape cancels, including IME preservation',()=>{
 const f=fixture();try{folder(f,'场景');query(f,'雨夜');const composing=key(f,'Escape',{isComposing:true});assert.equal(composing.defaultPrevented,false);assert.ok(f.root.querySelector('.agent-reference-path'));for(const value of ['Enter','Tab','ArrowDown'])key(f,value,{isComposing:true});assert.equal(f.picks.length,0);assert.equal(f.search.value,'雨夜');key(f,'Escape');assert.equal(f.root.querySelector('.agent-reference-path'),null);assert.deepEqual(f.cancels,[]);assert.equal(f.window.document.activeElement,f.search);key(f,'Escape');assert.deepEqual(f.cancels,[true]);assert.equal(f.root.inert,true);assert.equal(f.window.document.activeElement,f.anchor);key(f,'Enter');assert.equal(f.picks.length,0);}finally{f.close();}
});
test('root and folder Tab use clamped official navigation and preserve horizontal text caret keys',()=>{
 const f=fixture();try{const first=selected(f);key(f,'Tab',{shiftKey:true});assert.equal(selected(f),first);key(f,'Tab');assert.notEqual(selected(f),first);assert.deepEqual(f.cancels,[]);assert.equal(f.window.document.activeElement,f.search);folder(f,'角色');key(f,'Tab');const last=selected(f);key(f,'Tab');assert.equal(selected(f),last);key(f,'ArrowDown');assert.equal(selected(f),last);key(f,'Tab',{shiftKey:true});assert.equal(selected(f).dataset.selectableIndex,'0');for(const value of ['ArrowLeft','ArrowRight'])assert.equal(key(f,value).defaultPrevented,false);assert.equal(f.picks.length,0);}finally{f.close();}
});
test('mouse selection of directory actions shares the keyboard selection model and outside dismisses once',()=>{
 const f=fixture();try{folder(f,'角色');const use=f.root.querySelectorAll('.agent-reference-path button')[1];use.onpointerenter(new f.window.Event('pointerenter'));assert.equal(selected(f),use);key(f,'Enter');assert.equal(f.picks.length,1);use.click();f.control.cancel();assert.equal(f.picks.length,1);assert.deepEqual(f.cancels,[]);}finally{f.close();}
 const outside=fixture();try{folder(outside,'场景');outside.root.querySelector('.agent-reference-path button').click();assert.equal(outside.window.document.activeElement,outside.search);outside.window.document.getElementById('outside').dispatchEvent(new outside.window.Event('pointerdown',{bubbles:true}));assert.deepEqual(outside.cancels,[false]);assert.equal(outside.picks.length,0);}finally{outside.close();}
});

test('pointer mousedown keeps the search owner when entering folders and root no-results Tab permits exit',()=>{
 const f=fixture();try{query(f,'场景');const row=f.root.querySelector('.agent-reference-row'),mouse=new f.window.MouseEvent('mousedown',{bubbles:true,cancelable:true});row.dispatchEvent(mouse);assert.equal(mouse.defaultPrevented,true);row.click();assert.equal(f.window.document.activeElement,f.search);assert.equal(key(f,'Enter',{keyCode:229}).defaultPrevented,false);assert.equal(f.picks.length,0);key(f,'Escape');query(f,'no-results');assert.equal(f.root.querySelectorAll('[data-selectable-index]').length,0);const tab=key(f,'Tab');assert.equal(tab.defaultPrevented,false);assert.deepEqual(f.cancels,[]);f.window.document.getElementById('outside').focus();assert.deepEqual(f.cancels,[false]);assert.equal(f.root.inert,true);}finally{f.close();}
});
