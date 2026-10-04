const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
// Fabric already brings jsdom. These DOM-only tests do not need its optional
// native canvas binary, which is not built in the local installation.
const fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),oldCanvas=require.cache[canvasPath];
require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');if(oldCanvas)require.cache[canvasPath]=oldCanvas;else delete require.cache[canvasPath];
const modules=Promise.all([import('../src/features/agent-messages/messages.mjs'),import('../src/features/agent-messages/markdown.mjs')]);
async function fixture(){
 const [{createMessageRenderer},{renderMessageMarkdown}]=await modules,dom=new JSDOM('<main></main>');
 const original={document:global.document,setInterval:global.setInterval,clearInterval:global.clearInterval,now:Date.now};
 let now=100000,sequence=0;const clocks=new Map(),errors=[];
 global.document=dom.window.document;global.setInterval=fn=>{const id=++sequence;clocks.set(id,fn);return id;};global.clearInterval=id=>clocks.delete(id);Date.now=()=>now;
 const renderer=createMessageRenderer({renderMarkdown:renderMessageMarkdown,onError:error=>errors.push(error),onFeedback(){},onFork(){}});
 const message={role:'assistant',text:'',sentAt:now,stream:{requestId:'request',sessionId:'session',round:0,status:'streaming',thinking:false}};
 const options={key:'message',index:0,busy:true,lastAssistant:true},row=renderer.render(message,options);document.body.append(row);
 return {renderer,message,row,clocks,errors,dom,advance(ms){now+=ms;for(const fn of [...clocks.values()])fn();},update(options={}){return renderer.updateStreaming(row,message,options);},close(){renderer.destroy();dom.window.close();Object.assign(global,{document:original.document,setInterval:original.setInterval,clearInterval:original.clearInterval});Date.now=original.now;}};
}

test('official wait/real thinking status shows elapsed only after five seconds and disappears at first content',async()=>{
 const f=await fixture();try{
  const output=f.row.querySelector('output'),icon=output.querySelector('img');
  assert.equal(output.querySelector('.agent-stream-label').textContent,'处理中...');assert.match(icon.src,/assets\/agent-motion-thinking\.webp$/);
  assert.equal(output.getAttribute('aria-live'),'polite');assert.equal(f.row.querySelectorAll('button').length,0);assert.equal(f.clocks.size,1);
  f.advance(4000);assert.equal(output.querySelector('.agent-stream-elapsed').textContent,'');
  f.advance(1000);assert.equal(output.querySelector('.agent-stream-elapsed').textContent,'· 5s');
  f.advance(57000);assert.equal(output.querySelector('.agent-stream-elapsed').textContent,'· 1m2s');
  f.message.stream.thinking=true;f.update();assert.equal(f.row.querySelector('output'),output);assert.equal(output.querySelector('.agent-stream-label').textContent,'思考中...');
  f.message.text='第一段';f.update();assert.equal(f.row.querySelector('output'),null);assert.equal(f.clocks.size,0);assert.equal(f.row.querySelector('.agent-message-body').textContent.trim(),'第一段');
 }finally{f.close();}
});

test('120 real text updates preserve row, body, settled paragraph and growing text nodes',async()=>{
 const f=await fixture();try{
  f.message.text='已完成段落。\n\n进行中';f.update();
  const body=f.row.querySelector('.agent-message-body'),settled=body.firstChild,tail=body.querySelectorAll('p')[1],text=tail.firstChild;
  for(let i=0;i<120;i++){
   f.message.text+='字';assert.equal(f.update(),f.row);assert.equal(f.row.querySelector('.agent-message-body'),body);
   assert.equal(body.firstChild,settled);assert.equal(body.querySelectorAll('p')[1],tail);assert.equal(tail.firstChild,text);
  }
  assert.equal(f.row.querySelectorAll('button').length,0);assert.equal(f.row.getAttribute('aria-busy'),'true');
  const observer=new f.dom.window.MutationObserver(()=>{});observer.observe(f.row,{subtree:true,childList:true,characterData:true,attributes:true});
  for(let i=0;i<20;i++)f.update();assert.equal(observer.takeRecords().length,0);observer.disconnect();
 }finally{f.close();}
});

test('streaming Markdown safely handles incomplete code/link/table with live code controls and terminal message actions',async()=>{
 const f=await fixture();try{
  for(const text of ['**重点','**重点**\n\n```html\n<img src=x onerror=alert(1)>','**重点**\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n[危险](javascript:alert(1))\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>']){
   f.message.text=text;f.update();assert.equal(f.row.querySelectorAll('script,img,[onerror],a[href^="javascript:"],.agent-message-actions button').length,0);
  }
  assert.ok(f.row.querySelector('strong'));assert.ok(f.row.querySelector('table'));assert.match(f.row.querySelector('code').textContent,/<img src=x/);
  f.message.stream.status='done';f.update();assert.equal(f.row.querySelectorAll('.agent-message-actions button').length,0);assert.equal(f.row.querySelectorAll('.agent-code-actions button').length,2);
  f.update({busy:false});assert.equal(f.row.querySelectorAll('.agent-message-actions button').length,4);assert.equal(f.row.querySelectorAll('.agent-code-actions button').length,2);
  assert.equal(f.row.querySelector('output'),null);assert.equal(f.row.getAttribute('aria-busy'),'false');
  const copy=f.row.querySelector('.agent-message-actions button');f.update({busy:false});assert.equal(f.row.querySelector('.agent-message-actions button'),copy);
 }finally{f.close();}
});

test('interruption preserves received answer and safely displays reason without pretending reasoning content',async()=>{
 const f=await fixture();try{
  f.message.text='已收到的回答';f.update();f.message.stream.status='interrupted';f.update({busy:false});
  assert.equal(f.row.querySelector('.agent-message-body').textContent.trim(),'已收到的回答');assert.equal(f.row.querySelector('.agent-stream-interrupted').textContent,'你已停止本次回复');
  f.message.stream.error='<img src=x onerror=alert(1)> 连接已断开';f.update({busy:false});
  assert.equal(f.row.querySelectorAll('img').length,0);assert.equal(f.row.querySelector('.agent-stream-interrupted').textContent,f.message.stream.error);
  assert.equal(f.clocks.size,0);assert.equal(f.row.querySelector('output'),null);
 }finally{f.close();}
});

test('reset cancels UI clock and stale detached row updates cannot restart it',async()=>{
 const f=await fixture();try{
  assert.equal(f.clocks.size,1);f.renderer.reset();assert.equal(f.clocks.size,0);f.update();assert.equal(f.clocks.size,0);
  const restored=f.renderer.render({...f.message,text:'恢复正文',stream:{...f.message.stream,status:'done'}},{key:'restored',busy:false,lastAssistant:true,index:0});
  document.body.append(restored);assert.equal(restored.querySelector('.agent-message-body').textContent.trim(),'恢复正文');assert.equal(restored.querySelector('output'),null);
 }finally{f.close();}
});

test('official status asset and shimmer parameters are retained without invented icons',()=>{
 const root=require('node:path').join(__dirname,'..'),asset=fs.readFileSync(root+'/assets/agent-motion-thinking.webp'),css=fs.readFileSync(root+'/src/features/agent-messages/styles.css','utf8');
 assert.equal(asset.subarray(0,4).toString(),'RIFF');assert.equal(asset.subarray(8,12).toString(),'WEBP');
 assert.match(css,/agent-stream-shimmer 1\.7s linear infinite/);assert.match(css,/rgba\(255,255,255,\.46\)/);assert.match(css,/background-size:250% 100%,auto/);
 assert.match(css,/prefers-reduced-motion:reduce\)\{\.agent-stream-label\{animation:none/);
});

test('last-assistant action space is stable through empty waiting, text, tool wait and completion',async()=>{
 const f=await fixture();try{
  const placeholder=f.row.querySelector('[data-message-actions-placeholder]'),body=f.row.querySelector('.agent-message-body');
  assert.ok(placeholder);assert.equal(placeholder.getAttribute('aria-hidden'),'true');assert.equal(placeholder.children.length,0);
  assert.deepEqual([...f.row.children].map(node=>node.className),['agent-message-body chat-markdown','agent-stream-status','agent-message-actions-placeholder']);
  f.message.text='开始回答';f.update();assert.equal(f.row.querySelector('[data-message-actions-placeholder]'),placeholder);assert.equal(f.row.querySelector('.agent-message-body'),body);
  f.message.text='';f.update();assert.equal(f.row.querySelector('[data-message-actions-placeholder]'),placeholder);assert.equal(f.row.children[1].className,'agent-stream-status');
  f.message.text='```js\nconst x=1;\n```';f.message.stream.status='done';f.update();assert.equal(f.row.querySelector('[data-message-actions-placeholder]'),placeholder);assert.equal(f.row.querySelectorAll('.agent-message-actions button').length,0);assert.equal(f.row.querySelectorAll('.agent-code-actions button').length,2);
  f.update({busy:false});assert.equal(f.row.querySelector('[data-message-actions-placeholder]'),null);
  const toolbar=f.row.querySelector('.agent-message-actions'),codeActions=f.row.querySelector('.agent-code-actions');assert.ok(toolbar);assert.ok(codeActions);
  const replacement={...f.message,stream:{...f.message.stream}},observer=new f.dom.window.MutationObserver(()=>{});observer.observe(f.row,{subtree:true,childList:true,characterData:true,attributes:true});
  for(let i=0;i<10;i++)f.renderer.updateStreaming(f.row,replacement,{busy:false});
  assert.equal(observer.takeRecords().length,0);observer.disconnect();
  assert.equal(f.row.querySelector('.agent-message-actions'),toolbar);assert.equal(f.row.querySelector('.agent-code-actions'),codeActions);
  toolbar.querySelector('[data-feedback=up]').click();assert.equal(replacement.feedback,'up');assert.equal(f.message.feedback,undefined);
  const style=document.createElement('style');style.textContent=fs.readFileSync(require('node:path').join(__dirname,'../src/features/agent-messages/styles.css'),'utf8').replace(/^@import[^\n]*\n/,'');document.head.append(style);document.body.append(placeholder);
  const reserved=f.dom.window.getComputedStyle(placeholder),final=f.dom.window.getComputedStyle(toolbar);
  assert.equal(reserved.minHeight,final.minHeight);assert.equal(reserved.marginTop,final.marginTop);assert.equal(reserved.height,'24px');
 }finally{f.close();}
});

test('official action placeholder excludes users, earlier assistant rows, pending questions and suppressed actions',async()=>{
 const f=await fixture();try{
  for(const options of [{lastAssistant:false},{lastAssistant:true,pendingQuestion:true},{lastAssistant:true,pendingQuestion:false,suppressActions:true}]){
   f.update(options);assert.equal(f.row.querySelector('[data-message-actions-placeholder]'),null);assert.equal(f.row.querySelectorAll('button').length,0);
  }
  f.update({lastAssistant:true,pendingQuestion:false,suppressActions:false,busy:false});assert.ok(f.row.querySelector('[data-message-actions-placeholder]'));
  f.message.stream.status='done';f.update({busy:false});assert.equal(f.row.querySelector('[data-message-actions-placeholder]'),null);
  const user=f.renderer.render({role:'user',text:'问题'},{busy:true,lastAssistant:true});assert.equal(user.querySelector('[data-message-actions-placeholder]'),null);
 }finally{f.close();}
});

test('stopping with or without received content puts the divider after actions without remounting stable actions',async()=>{
 for(const text of ['', '已经收到的内容']){
  const f=await fixture();try{
   f.message.text=text;f.message.stream.status='interrupted';f.update({busy:false});
   assert.deepEqual([...f.row.children].map(node=>node.className),['agent-message-body chat-markdown','agent-message-actions','agent-stream-interrupted']);
   assert.equal(f.row.querySelector('.agent-message-body').hidden,!text);assert.equal(f.row.querySelector('output'),null);assert.equal(f.row.querySelector('[data-message-actions-placeholder]'),null);
   const toolbar=f.row.querySelector('.agent-message-actions');
   f.message.stream.error='连接断开';f.update({busy:false});assert.equal(f.row.querySelector('.agent-message-actions'),toolbar);assert.equal(f.row.lastElementChild.className,'agent-stream-interrupted');
   f.message.sentAt+=1000;f.update({busy:false});assert.equal(f.row.lastElementChild.className,'agent-stream-interrupted');assert.equal(f.row.children[1].className,'agent-message-actions');
   const observer=new f.dom.window.MutationObserver(()=>{});observer.observe(f.row,{subtree:true,childList:true,characterData:true,attributes:true});f.update({busy:false});assert.equal(observer.takeRecords().length,0);observer.disconnect();
  }finally{f.close();}
 }
});
