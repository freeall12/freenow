const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const sourcePath = require.resolve('../src/features/agent-apps/resources/apps/platform-resize@v1.897f4688.html'), source = fs.readFileSync(sourcePath, 'utf8');
const modulePromise = import('../src/features/agent-apps/platform-resize-local-interactions.mjs'), platformPromise = import('../src/features/agent-apps/platform-resize.mjs');
function section(html, from, to) {const start = html.indexOf(from), end = html.indexOf(to, start);assert.ok(start >= 0 && end > start);return html.slice(start, end);}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function brandedSource() {
  const proxy = fs.readFileSync(require.resolve('../src/features/agent-apps/resources/mcp-app-proxy.html'), 'utf8');
  const localize = vm.runInNewContext(section(proxy, '// PLATFORM_RESIZE_LOCAL_BRAND:BEGIN', '// PLATFORM_RESIZE_LOCAL_BRAND:END') + ';localizePlatformResizeBrand', {crypto:crypto.webcrypto, TextEncoder, Uint8Array});
  return localize(source, 'platform-resize', 'v1');
}
async function fixture(html) {
  const m = await platformPromise;
  const platforms = m.buildPlatformResizeFormats([
    {platform:'portrait',label_zh:'竖屏',label_en:'Portrait',ratio_id:'r_9_16',selected:false},
    {platform:'portrait_alt',label_zh:'另一竖屏',label_en:'Other portrait',ratio_id:'r_9_16',selected:true},
    {platform:'square',label_zh:'方图',label_en:'Square',ratio_id:'r_1_1',selected:true},
  ],1200,800);
  const preview = platforms[0], handlers = {}, capture = new Set(), paints = [], context = {
    ye:platforms, re:new Set(['portrait_alt','square']), Ze:false, ae:{code:'done'}, renders:0,
    Te(){context.renders++;},
  };
  vm.createContext(context);
  vm.runInContext(section(html, 'function hm(e)', 'it.ontoolresult=') + section(html, 'const zs=', 'function h_(e)') + ';globalThis.bind=g_;', context);
  const frame = {addEventListener:(type, fn)=>handlers[type]=fn, setPointerCapture:id=>capture.add(id), hasPointerCapture:id=>capture.has(id), releasePointerCapture:id=>capture.delete(id), getBoundingClientRect:()=>({width:600,height:400})};
  context.bind(frame,preview,(x,y)=>paints.push({x,y}),1000-preview.w,1000-preview.h);
  const event = (clientX,clientY)=>({clientX,clientY,pointerId:1,preventDefault(){}});
  const response = m.preparePlatformResize({node_ref:'node/source',project_id:'qa',preview:{data_uri:'data:image/png;base64,aGk=',width:1200,height:800},platforms});
  return {context,handlers,preview,event,paints,capture,request(){return {image_id:'node/source',project_id:'qa',crops:platforms.filter(p=>context.re.has(p.platform)).map(({platform,x,y,w,h})=>({platform,x,y,w,h}))};},validate(){return m.validatePlatformResizeApply(this.request(),response);}};
}
test('actual captured drag reproduces duplicate-ratio rejection; derived drag replaces the selection and preserves unrelated ratios', async () => {
  const old = await fixture(source);
  old.handlers.pointerdown(old.event(100,100));old.handlers.pointermove(old.event(160,100));old.handlers.pointerup(old.event(160,100));
  assert.deepEqual([...old.context.re], ['portrait_alt','square','portrait']);assert.throws(()=>old.validate(), /每宽高比只选一个/);
  const m = await modulePromise, local = await m.localizePlatformResizeInteractions(source,'platform-resize','v1'), fixed = await fixture(local);
  fixed.handlers.pointerdown(fixed.event(100,100));fixed.handlers.pointermove(fixed.event(160,100));
  assert.deepEqual([...fixed.context.re], ['portrait_alt','square'], 'selection changes only at the original drag commit boundary');
  fixed.handlers.pointerup(fixed.event(160,100));
  assert.deepEqual([...fixed.context.re], ['square','portrait']);assert.equal(fixed.preview.x,413);assert.equal(fixed.preview.y,0);
  assert.equal(fixed.context.ae,null);assert.equal(fixed.context.renders,1);assert.equal(fixed.capture.size,0);
  assert.deepEqual(fixed.validate().crops.map(p=>p.platform), ['portrait','square']);
});
test('no movement, busy state, clamping and native pointercancel keep the original drag semantics', async () => {
  const m = await modulePromise, local = await m.localizePlatformResizeInteractions(source,'platform-resize','v1');
  const still = await fixture(local);still.handlers.pointerdown(still.event(100,100));still.handlers.pointerup(still.event(100,100));
  assert.deepEqual([...still.context.re], ['portrait_alt','square']);assert.equal(still.context.renders,0);
  const busy = await fixture(local);busy.context.Ze=true;busy.handlers.pointerdown(busy.event(100,100));busy.handlers.pointermove(busy.event(200,100));busy.handlers.pointerup(busy.event(200,100));
  assert.equal(busy.capture.size,0);assert.equal(busy.preview.x,313);assert.equal(busy.context.renders,0);
  const cancelled = await fixture(local);cancelled.handlers.pointerdown(cancelled.event(100,100));cancelled.handlers.pointermove(cancelled.event(-1000,2000));cancelled.handlers.pointercancel(cancelled.event(-1000,2000));
  assert.equal(cancelled.preview.x,0);assert.equal(cancelled.preview.y,0);assert.equal(cancelled.capture.size,0);assert.deepEqual(cancelled.validate().crops.map(p=>p.platform), ['portrait','square']);
});
test('installed-source SHA and the existing branded derivative are the only accepted inputs; fixed UI and apply protocol stay unchanged', async () => {
  const m = await modulePromise, branded = await brandedSource();
  assert.equal(digest(source),m.platformResizeInteractionReferenceSha256);assert.equal(digest(branded),m.platformResizeBrandedReferenceSha256);
  for (const input of [source, branded]) {
    const local = await m.localizePlatformResizeInteractions(input,'platform-resize','v1');
    assert.equal(section(local,'const dm=','const zs='),section(input,'const dm=','const zs='));
    assert.equal(local.slice(local.indexOf('function h_(e)')),input.slice(input.indexOf('function h_(e)')), 'presets, callId dedupe, apply RPC and status rendering are byte-identical');
    for (const match of local.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) require('esbuild').transformSync(match[1], {loader:'js'});
    await assert.rejects(m.localizePlatformResizeInteractions(input+'\n','platform-resize','v1'), /integrity/);
    await assert.rejects(m.localizePlatformResizeInteractions(input,'platform-resize','v2'), /unsupported/);
  }
  assert.equal(await m.localizePlatformResizeInteractions('other bytes','character-blocking','v3'),'other bytes');
  assert.equal(fs.readFileSync(sourcePath,'utf8'),source);
});
