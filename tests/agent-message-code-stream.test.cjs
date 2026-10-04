const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),oldCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};const {JSDOM}=fabricRequire('jsdom');if(oldCanvas)require.cache[canvasPath]=oldCanvas;else delete require.cache[canvasPath];
const imports=Promise.all([import('../src/features/agent-messages/messages.mjs'),import('../src/features/agent-messages/markdown.mjs')]);
async function fixture(){
 const [{createMessageRenderer},{renderMessageMarkdown}]=await imports,dom=new JSDOM('<body></body>',{url:'http://localhost:4298/'}),previous={document:global.document,navigator:Object.getOwnPropertyDescriptor(global,'navigator')};global.document=dom.window.document;
 const clipboard=[],errors=[];let write=async text=>clipboard.push(text);Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{writeText:text=>write(text)}}});
 const renderer=createMessageRenderer({renderMarkdown:renderMessageMarkdown,onError:error=>errors.push(error),onFeedback(){},onFork(){}}),message={role:'assistant',text:'```js\nconst camera = { x: 2.375, description: "这是尚未结束的代码',stream:{status:'streaming'}};
 const row=renderer.render(message,{key:'code-stream',index:0,lastAssistant:true,busy:true});document.body.append(row);
 return {dom,renderer,message,row,clipboard,errors,setWrite(fn){write=fn;},update(options={}){renderer.updateStreaming(row,message,options);},close(){renderer.destroy();dom.window.close();global.document=previous.document;if(previous.navigator)Object.defineProperty(global,'navigator',previous.navigator);else delete global.navigator;}};
}
test('an unfinished streaming fence exposes live code controls; growth and completion preserve wrap, focus, scroll and actual copied text',async()=>{
 const f=await fixture();try{
  const code=f.row.querySelector('code'),pre=f.row.querySelector('pre'),block=f.row.querySelector('.chat-code-block'),toolbar=f.row.querySelector('.agent-code-actions'),[wrap,copy]=toolbar.children;
  assert.equal(f.row.querySelector('.agent-message-actions'),null);wrap.click();wrap.focus();pre.scrollLeft=37;
  for(let i=0;i<20;i++){f.message.text+='字';f.update();assert.equal(f.row.querySelector('code'),code);assert.equal(f.row.querySelector('.agent-code-actions'),toolbar);assert.equal(document.activeElement,wrap);assert.equal(block.dataset.wrap,'off');assert.equal(pre.scrollLeft,37);}
  await copy.onclick();assert.equal(f.clipboard.at(-1),code.textContent);assert.equal(copy.dataset.copied,'true');
  f.message.text+='" };\nconst z = -0.123456789;\n```\n\n完整正文。';f.message.stream.status='done';f.update({busy:false});
  assert.equal(f.row.querySelector('code'),code);assert.equal(f.row.querySelector('.agent-code-actions'),toolbar);assert.equal(document.activeElement,wrap);assert.equal(block.dataset.wrap,'off');assert.equal(pre.scrollLeft,37);assert.equal(copy.dataset.copied,'true');assert.equal(f.row.querySelectorAll('.agent-message-actions button').length,4);
  await copy.onclick();assert.equal(f.clipboard.at(-1),code.textContent);assert.match(f.clipboard.at(-1),/const z = -0\.123456789;/);assert.ok(!f.clipboard.at(-1).includes('完整正文'));
 }finally{f.close();}
});
test('copy snapshots the displayed chunk at click, does not fabricate clipboard success on rejection, and ignores a late result after reset',async()=>{
 const f=await fixture();try{
  const copy=f.row.querySelector('.agent-code-actions').lastElementChild;let release,written;
  f.setWrite(text=>{written=text;return new Promise(resolve=>release=resolve);});const snapshot=f.row.querySelector('code').textContent,pending=copy.onclick();f.message.text+='后来新增';f.update();release();await pending;assert.equal(written,snapshot);assert.equal(copy.dataset.copied,'true');
  f.setWrite(async()=>{throw Error('denied');});delete copy.dataset.copied;await copy.onclick();assert.equal(copy.dataset.copied,undefined);assert.deepEqual(f.errors,['复制失败，请检查浏览器剪贴板权限']);
  f.setWrite(()=>new Promise(resolve=>release=resolve));const late=copy.onclick();f.renderer.reset();release();await late;assert.equal(copy.dataset.copied,undefined);
 }finally{f.close();}
});
test('multiple fences keep distinct wrap state and code controls do not turn untrusted markup into active DOM',async()=>{
 const f=await fixture();try{
  f.message.text='```html\n<img src=x onerror=alert(1)>\n```\n\n```js\nconst two = 2;\n';f.update();const blocks=[...f.row.querySelectorAll('.chat-code-block')];assert.equal(blocks.length,2);assert.equal(f.row.querySelectorAll('img,script,[onerror]').length,0);blocks[1].querySelector('button').click();assert.equal(blocks[0].dataset.wrap,'on');assert.equal(blocks[1].dataset.wrap,'off');
  f.message.text+='const three = 3;';f.update();assert.equal(f.row.querySelectorAll('.agent-code-actions').length,2);assert.equal(blocks[1].dataset.wrap,'off');await blocks[1].querySelector('.agent-code-actions').lastElementChild.onclick();assert.match(f.clipboard.at(-1),/three = 3/);assert.ok(!f.clipboard.at(-1).includes('<img'));
 }finally{f.close();}
});
test('host code wrap survives sanitized renderer output that omits its initial data-wrap attribute',async()=>{
 const f=await fixture();try{
  const {patchMarkdown}=await import('../src/features/agent-messages/streaming.mjs'),body=f.row.querySelector('.agent-message-body'),block=body.querySelector('.chat-code-block'),wrap=block.querySelector('button');wrap.click();wrap.focus();
  patchMarkdown(body,'<div class="chat-code-block" data-language="js"><pre><code>更新正文</code></pre></div>');
  assert.equal(block.dataset.wrap,'off');assert.equal(document.activeElement,wrap);assert.equal(block.querySelector('code').textContent,'更新正文');assert.equal(block.querySelector('.agent-code-actions').children.length,2);
 }finally{f.close();}
});
