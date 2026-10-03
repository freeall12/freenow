const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('prompt mention original thumbnails and rejected local resolution keep placeholder and token without unhandled rejection',async()=>{
 const policy=await import('../src/features/local-resource-migration/display-media.mjs'),source=fs.readFileSync(require.resolve('../src/features/node-composer/prompt-editor.mjs'),'utf8'),start=source.indexOf('function mentionDOM('),end=source.indexOf('\nconst Mention=',start),assignments=[],unhandled=[];
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.isConnected=false;this.classList={add(){}};}
  append(...children){for(const child of children){this.children.push(child);child.parent=this;child.attach(this.isConnected);}}
  attach(value){this.isConnected=value;this.children.forEach(child=>child.attach(value));}
  replaceChildren(){this.children.forEach(child=>child.attach(false));this.children=[];}
  set src(value){assignments.push(value);}
 }
 let reads=0;const window={LocalAssets:{url:async source=>{reads++;if(source==='asset:missing')throw Error('missing media');if(source==='asset:redirect')return 'https://tapnow.media/rejected.png';return source;}}};
 const c=vm.createContext({window,displayMediaRef:policy.displayMediaRef,pendingImportMessage:policy.pendingImportMessage,el:(tag,cls,text)=>Object.assign(new Element(tag),{className:cls,textContent:text}),subjectIcons:{},musicIcon:'',referenceIcons:{imageType:'<svg/>',videoType:'<svg/>'},icons:{}});vm.runInContext(source.slice(start,end),c);
 const capture=error=>unhandled.push(error);process.on('unhandledRejection',capture);
 try{
  for(const thumbnail of ['https://files.tapnow.media/old.png','asset:missing','asset:redirect']){
   const attrs={type:'image',thumbnail,token:'{{节点/保留}}',key:'stable-reference',label:'原引用'},before=JSON.stringify(attrs),root=c.mentionDOM(attrs);root.attach(true);await new Promise(resolve=>setImmediate(resolve));
   assert.equal(root.dataset.promptToken,attrs.token);assert.equal(root.dataset.referenceKey,attrs.key);assert.equal(root.children.at(-1).textContent,attrs.label);assert.match(root.title,/重新导入/);assert.equal(root.children[0].children.length,0);assert.equal(JSON.stringify(attrs),before);
  }
  assert.equal(reads,2);assert.deepEqual(assignments,[]);assert.deepEqual(unhandled,[]);
 }finally{process.removeListener('unhandledRejection',capture);}
});
