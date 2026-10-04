const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previous=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};const {JSDOM}=fabricRequire('jsdom');if(previous)require.cache[canvasPath]=previous;else delete require.cache[canvasPath];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const dom=new JSDOM('<body></body>',{url:'http://localhost:4195/'}),document=dom.window.document;dom.window.HTMLMediaElement.prototype.pause=function(){};dom.window.HTMLMediaElement.prototype.load=function(){};return {dom,document,close(){dom.window.close();}};}
test('sent image/video resolve only local assets, preserve ordering and show actual decode states',async()=>{
 const {createMessageAttachments}=await import('../src/features/agent-messages/attachments.mjs'),f=fixture(),calls=[];
 const items=[{id:'i',asset:'asset:image',name:'图片.png',mime:'image/png'},{id:'v',asset:'asset:video',name:'视频.mp4',mime:'video/mp4'}],before=structuredClone(items);
 const strip=createMessageAttachments(items,{document:f.document,assets:{url:async id=>{calls.push(id);return 'blob:http://localhost:4195/'+id;}}});f.document.body.append(strip.element);await tick();
 assert.deepEqual(calls,['asset:image','asset:video']);assert.deepEqual(items,before);const image=strip.element.querySelector('img'),video=strip.element.querySelector('video');assert.ok(image);assert.ok(video);assert.equal(video.muted,true);assert.equal(video.playsInline,true);assert.equal(video.preload,'metadata');assert.match(video.src,/#t=0.1$/);assert.equal(strip.element.children[0].dataset.state,'loading');image.onload();video.onloadeddata();assert.equal(strip.element.children[0].dataset.state,'ready');assert.equal(strip.element.children[1].dataset.state,'ready');strip.destroy();f.close();
});
test('remote/missing/unsupported/decode failures keep a bounded type fallback without outbound resolution',async()=>{
 const {createMessageAttachments}=await import('../src/features/agent-messages/attachments.mjs'),f=fixture(),calls=[];
 const strip=createMessageAttachments([{asset:'https://files.tapnow.media/old.png',mime:'image/png',name:'旧图'},{asset:'https://example.com/old.mp4',mime:'video/mp4',name:'外链'},{asset:'javascript:alert(1)',mime:'image/png',name:'无效'},{asset:'asset:missing',mime:'image/png',name:'缺失'},{asset:'asset:pdf',mime:'application/pdf',name:'PDF'},{asset:'asset:bad',mime:'video/mp4',name:'坏视频'}],{document:f.document,assets:{url:async id=>{calls.push(id);if(id==='asset:missing')throw Error('missing');return 'blob:http://localhost:4195/bad';}}});f.document.body.append(strip.element);await tick();assert.deepEqual(calls,['asset:missing','asset:bad']);assert.equal(strip.element.children.length,6);strip.element.querySelector('video').onerror();assert.equal(strip.element.querySelectorAll('img,video').length,0);assert.equal(strip.element.querySelectorAll('svg').length,6);assert.equal(strip.element.children[5].dataset.reason,'decode_failed');strip.destroy();f.close();
});
test('disposed strips ignore a late local lookup and never mount a stale media element',async()=>{
 const {createMessageAttachments}=await import('../src/features/agent-messages/attachments.mjs'),f=fixture();let release;const lookup=new Promise(resolve=>release=resolve);
 const strip=createMessageAttachments([{asset:'asset:late',mime:'image/png',name:'迟到'}],{document:f.document,assets:{url:()=>lookup}});f.document.body.append(strip.element);await tick();strip.destroy();release('blob:http://localhost:4195/late');await tick();assert.equal(strip.element.querySelector('img'),null);assert.equal(strip.element.isConnected,false);f.close();
});
test('production renderer retains the same decoded thumbnail through unrelated redraws and prunes switched conversations',async()=>{
 const {createMessageRenderer}=await import('../src/features/agent-messages/messages.mjs'),f=fixture(),oldDocument=global.document;global.document=f.document;let lookups=0;
 try {f.dom.window.LocalAssets={url:async()=>{lookups++;return 'blob:http://localhost:4195/image';}};const renderer=createMessageRenderer({renderMarkdown:text=>text,onError:()=>{},onFeedback:()=>{},onFork:()=>{}}),message={role:'user',text:'已发送',uploads:[{id:'1',asset:'asset:one',name:'图.png',mime:'image/png'}]};
 f.document.body.append(renderer.render(message,{key:'chat:1'}));await tick();const image=f.document.querySelector('img');image.onload();
 renderer.reset();f.document.body.replaceChildren(renderer.render(structuredClone(message),{key:'chat:1'}));await tick();assert.equal(f.document.querySelector('img'),image);assert.equal(lookups,1);assert.equal(image.parentElement.dataset.state,'ready');assert.match(f.document.body.textContent,/已发送/);
 renderer.reset();f.document.body.replaceChildren(renderer.render({role:'user',text:'另一个会话'},{key:'chat:2'}));await tick();assert.equal(image.hasAttribute('src'),false);assert.equal(f.document.querySelector('.agent-message-attachments'),null);renderer.destroy();
 }finally{global.document=oldDocument;f.close();}
});
