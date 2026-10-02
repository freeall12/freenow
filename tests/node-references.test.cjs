const test=require('node:test'),assert=require('node:assert/strict');
test('generation references include live connected media and text, deduplicate saved thumbnails, and follow source replacements',async()=>{
 const {referencesFor,referenceInputs}=await import('../src/features/node-composer/reference-model.mjs');
 const target={id:'target',type:'video'},nodes=[{id:'image',type:'image',image:'/new.png'},{id:'video',type:'video',video:'/movie.mp4',image:'/poster.png'},{id:'audio',type:'audio',audio:'/voice.wav'},{id:'text',type:'text',content:'运镜要求'}];
 const state={nodes,edges:nodes.map(n=>({id:n.id,source:n.id,target:'target'}))};
 const items=referencesFor(target,{refs:['/old.png','/poster.png'],referenceBindings:['image','video']},state);
 assert.deepEqual(referenceInputs(items).map(({type,url,text})=>[type,url||text]),[['image','/new.png'],['video','/movie.mp4'],['audio','/voice.wav'],['text','运镜要求']]);
});
test('disconnecting references removes legacy copies while preserving other reference order',async()=>{
 const {withoutSources}=await import('../src/features/node-composer/reference-model.mjs');
 const config={refs:['/a.png','/b.png','/c.png'],referenceBindings:['a',null,null],referenceOrder:['saved:2','node:a','saved:1']};
 const next=withoutSources(config,[{id:'a',image:'/a.png'}]);
 assert.deepEqual(next.refs,['/b.png','/c.png']);assert.deepEqual(next.referenceOrder,['saved:1','saved:0']);assert.equal(config.refs.length,3);
});
test('reference ordering is persisted within each media type and empty sources cannot be submitted',async()=>{
 const {referencesFor,referenceInputs,reorderReferences,orderInputs}=await import('../src/features/node-composer/reference-model.mjs');
 const target={id:'t',type:'video'},state={nodes:[{id:'a',type:'image',image:'/a.png'},{id:'b',type:'image',image:'/b.png'},{id:'c',type:'text',content:'文字'}],edges:['a','b','c'].map(id=>({id,source:id,target:'t'}))};
 const items=referencesFor(target,{},state),config=reorderReferences({},items,0,1);
 assert.deepEqual(referenceInputs(referencesFor(target,config,state)).map(i=>i.id),['b','a','c']);
 assert.deepEqual(orderInputs(config,referenceInputs(items)).map(i=>i.id),['b','a','c']);
 assert.deepEqual(reorderReferences(config,items,0,2),config);
 state.nodes[0].image=null;assert.throws(()=>referenceInputs(referencesFor(target,config,state)),/参考节点没有内容/);
});
test('reference tokens keep source identity across reorder and atomic removal, including unbound saved images',async()=>{
 const {reconcilePrompt}=await import('../src/features/node-composer/prompt-state.mjs');
 const {reorderReferences,removeReference,withoutSources}=await import('../src/features/node-composer/reference-model.mjs');
 const items=[{key:'node:a',type:'image'},{key:'saved:0',type:'image'},{key:'saved:1',type:'image'},{key:'node:t',type:'text'}];
 const config=reconcilePrompt({prompt:'{{Image 1}} 对照 {{Image 3}} {{Text 1}}',refs:['/b.png','/c.png']},items);
 const sorted=reorderReferences(config,items,0,2);assert.equal(sorted.prompt,'{{Image 3}} 对照 {{Image 2}} {{Text 1}}');
 const removed=removeReference(config,{key:'saved:0',savedIndices:[0]});assert.equal(removed.prompt,'{{Image 1}} 对照 {{Image 2}} {{Text 1}}');assert.equal(removed.promptReferenceBindings[1].referenceKey,'saved:0');
 const disconnected=withoutSources(config,[{id:'a'}]);assert.equal(disconnected.prompt,' 对照 {{Image 2}} {{Text 1}}');assert.equal(config.prompt,'{{Image 1}} 对照 {{Image 3}} {{Text 1}}');
});
test('prompt documents retain multiline text, literal markup and atomic focus/reference tokens',async()=>{
 const {promptDocument,documentText,projectPrompt}=await import('../src/features/node-composer/prompt-state.mjs');
 const value='第一行\n\n{{Image 1}} <img src=x> {{magic_item:{"_markId":"focus-1","label_name":"天空"}}}\n';
 const doc=promptDocument(value,[{key:'node:a',title:'画面',type:'image'}]);assert.equal(documentText(doc),value);assert.equal(doc.content[2].content.filter(n=>n.type==='promptMention').length,2);
 const inputs=[{type:'image',url:'/a.png'},{type:'text',text:'沿河运镜'},{type:'text',text:'暖色调'}];
 assert.equal(projectPrompt('{{Text 1}} 与 {{Image 1}}',inputs),'暖色调\n沿河运镜 与 {{Image 1}}');
 assert.equal(projectPrompt('{{Text 1}}{{Text 2}}',inputs),'沿河运镜\n暖色调');
});
test('library Asset tokens preserve quoted braces, literal ordinal examples and clipboard document identity',async()=>{
 const {libraryAsset,assetToken,assetSegments}=await import('../src/features/node-composer/library-mentions.mjs');
 const {promptDocument,documentText,reconcilePrompt,projectGenerationPrompt}=await import('../src/features/node-composer/prompt-state.mjs');
 const data=libraryAsset({id:'script',scope:'team',name:'示例 } "镜头"',type:'text',content:'保留 {{Image 1}} 和右括号 } 以及 "引号"'}),token=assetToken(data);
 assert.deepEqual(assetSegments(token)[1].asset,data);assert.equal(documentText(promptDocument(token)),token);
 assert.equal(reconcilePrompt({prompt:token,promptReferenceBindings:[{referenceKey:'node:gone',renderText:'Image 1'}]},[]).prompt,token);
 assert.equal(projectGenerationPrompt(token,[],['text']).prompt,data.content);
 const malformed='{{Asset:{"id":"bad","nodeId":"bad","nodeType":"script"}}}';assert.equal(documentText(promptDocument(malformed)),malformed);
});
test('library references project ordered media once, inline text and reject unsupported or empty assets before submission',async()=>{
 const {libraryAsset,assetToken,libraryPolicy}=await import('../src/features/node-composer/library-mentions.mjs');
 const {projectGenerationPrompt}=await import('../src/features/node-composer/prompt-state.mjs');
 const token=item=>assetToken(libraryAsset(item)),image=token({id:'i',type:'image',image:'/b.png',name:'B'}),audio=token({id:'a',type:'audio',audio:'/a.wav',name:'A',scope:'team'}),text=token({id:'t',type:'text',content:'新文本'});
 const value=projectGenerationPrompt(image+' '+image+' '+audio+' '+text,[{type:'image',url:'/a.png'},{type:'text',text:'上游文本'}],['image','audio','text']);
 assert.equal(value.prompt,'上游文本\n{{Image 2}} {{Image 2}} {{Audio 1}} 新文本');assert.deepEqual(value.inputs.filter(i=>i.url).map(i=>i.url),['/a.png','/b.png','/a.wav']);assert.equal(value.inputs.at(-1).scope,'team');
 assert.throws(()=>projectGenerationPrompt(audio,[],['image','text']),/不支持/);
 assert.throws(()=>projectGenerationPrompt(token({id:'empty',type:'image'}),[],['image']),/没有内容/);
 assert.equal(libraryPolicy('video','Seedance 2.0','全能参考').enabled,true);assert.equal(libraryPolicy('video','Seedance 2.0','首尾帧').enabled,false);assert.deepEqual(libraryPolicy('video','Kling 3.0','全能参考').allowed,['image','text']);
});
test('subject atomic tokens survive clipboard and selection removal',async()=>{
 const {subjectToken,replaceSubjects,subjectIds}=await import('../src/features/subject-library/model.mjs');
 const {promptDocument,documentText}=await import('../src/features/node-composer/prompt-state.mjs');
 const subject={id:'s',name:'人物：} "A"'},prompt='镜头\n'+subjectToken(subject)+'行走';
 const doc=promptDocument(prompt);assert.equal(documentText(doc),prompt);assert.equal(doc.content[1].content[0].attrs.type,'subject');assert.deepEqual(subjectIds(prompt),['s']);assert.equal(replaceSubjects(prompt,[]),'镜头\n行走');
});
