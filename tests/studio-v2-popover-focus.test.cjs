const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];
require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');
if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const modulePromise=import('../src/features/studio-v2/popover-focus.mjs');

async function fixture(t){
  const methods=await modulePromise,dom=new JSDOM('<body><button id="trigger">添加模型</button><div id="panel" role="dialog" tabindex="-1"><input type="file" hidden><button aria-label="上传模型">上传</button><button aria-label="补充关联资源">资源</button></div><button id="outside">其他操作</button></body>');
  t.after(()=>dom.window.close());
  const document=dom.window.document,panel=document.getElementById('panel'),trigger=document.getElementById('trigger'),outside=document.getElementById('outside');
  return {...methods,document,panel,trigger,outside};
}

test('opening a popover focuses an available control instead of its hidden file input',async t=>{
  const f=await fixture(t);f.focusPopover(f.panel);
  assert.equal(f.document.activeElement.getAttribute('aria-label'),'上传模型');
  f.panel.querySelectorAll('button').forEach(button=>button.disabled=true);f.focusPopover(f.panel);
  assert.equal(f.document.activeElement,f.panel);
});

test('Tab-style focus departure dismisses while movement between controls and the trigger remains open',async t=>{
  const f=await fixture(t);let dismissals=0;
  const dispose=f.bindPopoverFocus(f.panel,{trigger:f.trigger,onDismiss:()=>dismissals++});t.after(dispose);
  f.focusPopover(f.panel);f.panel.querySelector('[aria-label="补充关联资源"]').focus();await Promise.resolve();assert.equal(dismissals,0);
  f.trigger.focus();await Promise.resolve();assert.equal(dismissals,0);
  f.focusPopover(f.panel);f.outside.focus();await Promise.resolve();assert.equal(dismissals,1);
});

test('import control replacement preserves focus without dismissing the new content',async t=>{
  const f=await fixture(t);let dismissals=0;
  const dispose=f.bindPopoverFocus(f.panel,{trigger:f.trigger,onDismiss:()=>dismissals++});t.after(dispose);
  const old=f.panel.querySelector('[aria-label="补充关联资源"]');old.focus();
  const restore=f.preservePopoverFocus(f.panel);old.blur();f.panel.innerHTML='<button aria-label="上传模型">上传</button><button aria-label="补充关联资源">资源已添加</button>';restore();
  await Promise.resolve();assert.equal(dismissals,0);assert.equal(f.document.activeElement.getAttribute('aria-label'),'补充关联资源');
  const loadingFocus=f.preservePopoverFocus(f.panel);f.panel.innerHTML='<button disabled aria-label="上传模型">正在保存</button>';loadingFocus();
  assert.equal(f.document.activeElement,f.panel);
});

test('an inside mouse press that blurs to body leaves the popup connected until its action click',async t=>{
  const f=await fixture(t);let actions=0,dismissals=0;
  const dispose=f.bindPopoverFocus(f.panel,{trigger:f.trigger,onDismiss:()=>{dismissals++;f.panel.remove();}});t.after(dispose);
  const upload=f.panel.querySelector('[aria-label="上传模型"]'),action=f.panel.querySelector('[aria-label="补充关联资源"]');
  action.onclick=()=>actions++;upload.focus();
  action.dispatchEvent(new f.document.defaultView.MouseEvent('pointerdown',{bubbles:true}));upload.blur();
  await Promise.resolve();assert.equal(f.document.activeElement,f.document.body);assert.equal(f.panel.isConnected,true);
  action.click();assert.equal(actions,1);assert.equal(dismissals,0);
});

test('saving prevents dismissal and disposed or removed popovers ignore pending focus checks',async t=>{
  const f=await fixture(t);let busy=true,dismissals=0;
  const dispose=f.bindPopoverFocus(f.panel,{trigger:f.trigger,canDismiss:()=>!busy,onDismiss:()=>dismissals++});
  f.focusPopover(f.panel);f.outside.focus();await Promise.resolve();assert.equal(dismissals,0);
  busy=false;f.focusPopover(f.panel);f.outside.focus();dispose();await Promise.resolve();assert.equal(dismissals,0);
  f.bindPopoverFocus(f.panel,{trigger:f.trigger,onDismiss:()=>dismissals++});f.focusPopover(f.panel);f.outside.focus();f.panel.remove();await Promise.resolve();assert.equal(dismissals,0);
});

test('background inspection does not move focus back into the import popover',async t=>{
  const f=await fixture(t);f.outside.focus();const restore=f.preservePopoverFocus(f.panel);f.panel.innerHTML='<button aria-label="上传模型">检查完成</button>';restore();
  assert.equal(f.document.activeElement,f.outside);
});

test('the first empty-scene import restores the new toolbar trigger when its original trigger is removed or hidden',async t=>{
  const f=await fixture(t),toolbar=f.document.createElement('button');toolbar.ariaLabel='添加模型';f.document.body.append(toolbar);
  f.trigger.remove();f.focusPopoverTrigger(f.trigger,toolbar);assert.equal(f.document.activeElement,toolbar);
  const empty=f.document.createElement('section');empty.hidden=true;empty.append(f.trigger);f.document.body.append(empty);
  f.outside.focus();f.focusPopoverTrigger(f.trigger,toolbar);assert.equal(f.document.activeElement,toolbar);
  f.outside.focus();f.focusPopoverTrigger(f.trigger);assert.equal(f.document.activeElement,f.outside);
});
