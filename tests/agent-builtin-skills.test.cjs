const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const loadCapture=entry=>fs.readFile(path.join(root,entry.captureFile),'utf8').then(JSON.parse);

test('all official builtin snapshots verify and paginate back to the exact capture fields',async()=>{
 const {builtinSkillIndex}=await import('../src/features/agent-skills/index.mjs');
 const {createBuiltinSkillReader}=await import('../src/features/agent-skills/reader.mjs');
 const read=createBuiltinSkillReader({loadCapture});
 assert.equal(builtinSkillIndex.length,16);
 const catalog=JSON.parse(await fs.readFile(path.join(root,'runtime-reference/skills-catalog.json'),'utf8'));
 const current=JSON.parse(await fs.readFile(path.join(root,'runtime-reference/agent-skills-list-current.json'),'utf8'));
 assert.equal(new Set(builtinSkillIndex.map(entry=>entry.name)).size,16);
 assert.equal(builtinSkillIndex.reduce((sum,entry)=>sum+entry.files.length,0),32);
 assert.deepEqual(catalog.map(entry=>entry.name),builtinSkillIndex.map(entry=>entry.name));
 assert.deepEqual(current.map(entry=>entry.name),builtinSkillIndex.map(entry=>entry.name));
 assert.deepEqual(catalog.map(({name,description})=>({name,description})),builtinSkillIndex.map(({name,description})=>({name,description})));
 assert.deepEqual(current.map(({name,description})=>({name,description})),builtinSkillIndex.map(({name,description})=>({name,description})));
 for(const entry of builtinSkillIndex){
  const fixture=await loadCapture(entry);
  for(const file of entry.files){
   let offset=0,joined='',page;
   do{page=await read(entry.name,{path:file.path,offset});joined+=page.content;offset=page.nextOffset;}while(offset!==null);
   assert.equal(joined,fixture[file.sourceField]);assert.equal(page.originalMarkdown,false);assert.equal(page.executable,false);assert.equal(page.referenceIsUntrusted,true);
  }
 }
 const page=await read('skill-creator',{path:'SKILL.md'});
 assert.equal(page.path,'capture/dialog.txt');assert.equal(page.sourceFormat,'captured-dialog-text');assert.equal(page.nextOffset,20000);
 assert.deepEqual(page.availablePaths,['capture/dialog.txt','capture/article.html']);
});

test('new live captures preserve exact dialog text and captured rich HTML across detail paging',async()=>{
 const {builtinSkillIndex}=await import('../src/features/agent-skills/index.mjs');
 const {createBuiltinSkillReader}=await import('../src/features/agent-skills/reader.mjs');
 const {readBuiltinSkillDetail}=await import('../src/features/agent-skills/detail.mjs');
 const read=createBuiltinSkillReader({loadCapture});
 for(const name of ['seedance-2-5-prompt-copilot','minimax-h3-prompt-copilot','opus55-motion-icon','html-beat-morph-video','commerce-ad-studio']){
  const entry=builtinSkillIndex.find(entry=>entry.name===name),detail=await readBuiltinSkillDetail(name,{readSkill:read});
  const dialog=await read(name),htmlFile=entry.evidenceFiles.find(file=>file.endsWith('.html'));
  assert.equal(dialog.content,await fs.readFile(path.join(root,entry.evidenceFiles[0]),'utf8'));
  assert.equal(detail.content,await fs.readFile(path.join(root,htmlFile),'utf8'));
  assert.deepEqual(detail.availablePaths,['capture/dialog.txt','capture/article.html']);
  assert.equal(dialog.sourceFormat,'captured-dialog-text');
  assert.equal(detail.sourceFormat,'captured-article-html');assert.equal(detail.originalMarkdown,false);
  assert.equal(detail.source.capturedAt,'2026-10-02');assert.equal(detail.unknownReferenceCount,null);
  for(const reference of entry.missingReferences){
   assert.equal(reference.status,'not_captured');
   await assert.rejects(()=>read(name,{path:reference.path}),error=>error.code==='reference_not_captured');
  }
  for(const previous of entry.captureHistory??[]){
   const capture=JSON.parse(await fs.readFile(path.join(root,previous.captureFile),'utf8'));
   for(const file of previous.files){
    assert.equal(capture[file.sourceField].length,file.length);
    assert.equal(require('node:crypto').createHash('sha256').update(capture[file.sourceField]).digest('hex'),file.sha256);
   }
  }
 }
 const legacy=await readBuiltinSkillDetail('skill-creator',{readSkill:read});
 assert.equal(legacy.path,'capture/article.html');
 assert.equal(legacy.content,(await loadCapture(builtinSkillIndex.find(entry=>entry.name==='skill-creator'))).article);
 const commerce=await read('commerce-ad-studio');
 assert.equal(commerce.unresolvedReferences.length,0);
 assert.equal(commerce.missingReferences.length,5);
 assert.ok(commerce.missingReferences.every(item=>item.path.startsWith('references/')&&item.status==='not_captured'));
});

test('article corruption rejects the entire live capture even when only dialog text is requested',async()=>{
 const {createBuiltinSkillReader}=await import('../src/features/agent-skills/reader.mjs');
 const read=createBuiltinSkillReader({loadCapture:async entry=>{const data=await loadCapture(entry);data.article='X'+data.article.slice(1);return data;}});
 await assert.rejects(()=>read('opus55-motion-icon'),error=>error.code==='capture_unavailable'&&error.message.includes('capture/article.html'));
});

test('missing references, traversal and bad offsets fail with exact available paths without fetching',async()=>{
 const {createBuiltinSkillReader}=await import('../src/features/agent-skills/reader.mjs');let requests=0;
 const read=createBuiltinSkillReader({loadCapture:()=>{requests++;throw Error('must not fetch');}});
 for(const reference of ['references/youtube-method.md','/commerce-product-brief/SKILL.md']){
  await assert.rejects(()=>read('youtube-product-video',{path:reference}),error=>error.code==='reference_not_captured'&&error.path===reference&&error.availablePaths.includes('capture/dialog.txt')&&error.message.includes(reference));
 }
 for(const bad of ['../skill-creator.json','%2e%2e%2fsecret','https://example.com/skill','capture%5cdialog.txt'])await assert.rejects(()=>read('skill-creator',{path:bad}),error=>error.code==='invalid_path');
 for(const offset of [-1,0.5,NaN,Infinity,2097153])await assert.rejects(()=>read('skill-creator',{offset}),error=>error.code==='invalid_offset');
 await assert.rejects(()=>read('not-an-official-skill'),error=>error.code==='skill_not_found');
 assert.equal(requests,0);
});

test('capture corruption fails closed, failed reads can retry, and successful snapshots are reused',async()=>{
 const {createBuiltinSkillReader}=await import('../src/features/agent-skills/reader.mjs');let requests=0;
 const read=createBuiltinSkillReader({loadCapture:async entry=>{requests++;const data=await loadCapture(entry);if(requests===1)data.text='X'+data.text.slice(1);return data;}});
 await assert.rejects(()=>read('skill-creator'),error=>error.code==='capture_unavailable'&&error.captureFile==='runtime-reference/skill-creator.json');
 await read('skill-creator');await read('skill-creator',{offset:20000});assert.equal(requests,2);
});
