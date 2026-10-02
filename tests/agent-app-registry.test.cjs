const test=require('node:test'),assert=require('node:assert/strict');
test('only integrated versioned apps and actual template IDs prepare display receipts',async()=>{
 const {prepareApp,appPolicy}=await import('../src/features/agent-apps/registry.mjs');
 for(const resource_uri of ['ui://tapnow/previs@v3','https://example.com/app','ui://tapnow/motion-picker@v2','ui://tapnow/../motion-picker@v1'])assert.throws(()=>prepareApp({resource_uri}));
 const resource_uri='ui://tapnow/motion-picker@v1',result=prepareApp({resource_uri,recommended_template_id:'G16',original_request:'产品动效'});assert.equal(result.response.recommended_template_id,'G16');assert.equal(result.response.original_request,'产品动效');assert.equal(result.kind,'mcp_app');assert.equal(appPolicy(resource_uri).maxInlineHeight,520);
 for(const recommended_template_id of ['T00','T31','G17','A01'])assert.throws(()=>prepareApp({resource_uri,recommended_template_id}));
 assert.throws(()=>prepareApp({resource_uri,tools:['canvas_delete']}));assert.equal(prepareApp({resource_uri:'ui://tapnow/website-design-picker@v1'}).response.family,'website');
});
test('app state is an independent bounded JSON object, not shared mutable template data',async()=>{
 const {copyAppState}=await import('../src/features/agent-apps/registry.mjs'),original={version:1,selectedId:'T01',pending:{accepted:false}},copy=copyAppState(original);original.pending.accepted=true;assert.equal(copy.pending.accepted,false);
 for(const value of [null,[],{text:'x'.repeat(65537)}])assert.throws(()=>copyAppState(value));
});
