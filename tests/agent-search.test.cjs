'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWebSearch,normalizeSearchResponse}=require('../server/agent-search.cjs');
const tools=require('../agent-tools.js');
const fixture=()=>({id:'response-fixture',status:'completed',output:[{type:'web_search_call',id:'search-fixture',status:'completed',action:{type:'search',queries:['fixture query'],sources:[{type:'url',url:'https://openai.com/docs'},{type:'url',url:'https://example.org/related'},{type:'url',url:'http://127.0.0.1/private'}]}},{type:'message',content:[{type:'output_text',text:'Evidence [1]',annotations:[{type:'url_citation',url:'https://openai.com/docs',title:'Official docs',start_index:9,end_index:12},{type:'url_citation',url:'javascript:alert(1)',title:'Unsafe',start_index:0,end_index:1}]},{type:'output_text',text:'More [2]',annotations:[{type:'url_citation',url:'https://example.org/related',title:'Related',start_index:5,end_index:8}]}]}]});
test('search tool is callable by main/read-only worker and editor group contracts are integrated',()=>{
 assert.equal(tools.parse('web_search',{query:'current references'}).definition.mutates,false);
 assert.ok(tools.delegationTools.includes('web_search'));
 assert.throws(()=>tools.parse('web_search',{query:'   '}));
 const common={nodeId:'node',sessionId:'session',expectedRevision:0};
 tools.parse('image_editor_edit',{...common,action:'group',objectIds:['a','b'],name:'Group'});
 tools.parse('image_editor_edit',{...common,action:'ungroup',objectId:'group'});
 assert.throws(()=>tools.parse('image_editor_edit',{...common,action:'group',objectIds:['a','a']}));
});
test('missing configuration is honest and makes no model request',async()=>{
 let count=0;const service=createWebSearch({client:{responses:{create:()=>{count++;}}}});
 assert.equal(service.config().availabilityVerified,false);
 await assert.rejects(service.search({query:'public topic'}),{code:'configuration_required'});assert.equal(count,0);
});
test('SDK adapter forces real web_search, keeps source identity and exact joined text offsets',async()=>{
 let request,options;const service=createWebSearch({model:'fixture-model',client:{responses:{create:async(body,opts)=>{request=body;options=opts;return fixture();}}},now:()=>0});
 const result=await service.search({query:'fixture query',allowed_domains:['openai.com']});
 assert.deepEqual(request.tools,[{type:'web_search',external_web_access:true,search_context_size:'medium',filters:{allowed_domains:['openai.com']}}]);
 assert.deepEqual(request.tool_choice,{type:'web_search'});assert.deepEqual(request.include,['web_search_call.action.sources']);assert.equal(request.store,false);assert.equal(options.maxRetries,0);
 assert.equal(result.status,'completed');assert.equal(result.untrusted,true);assert.equal(result.text,'Evidence [1]\n\nMore [2]');assert.equal(result.sources.length,2);assert.equal(result.sources[0].title,'Official docs');
 assert.equal(result.citations.length,2);assert.equal(result.text.slice(result.citations[1].start_index,result.citations[1].end_index),'[2]');assert.equal(result.droppedSources,2);
});
test('unperformed or incomplete calls cannot become a successful search; empty retrieval stays no_results',async()=>{
 await assert.rejects(normalizeSearchResponse({status:'completed',output:[]}),{code:'search_not_performed'});
 const incomplete=fixture();incomplete.status='incomplete';await assert.rejects(normalizeSearchResponse(incomplete),{code:'search_incomplete'});
 const failed=fixture();failed.output[0].status='failed';await assert.rejects(normalizeSearchResponse(failed),{code:'search_not_performed'});
 const empty={status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[]}}]};assert.equal((await normalizeSearchResponse(empty)).status,'no_results');
});
test('unsafe URLs and URL-shaped domain filters are rejected before provider invocation',async()=>{
 const {safePublicUrl,validateSearchInput}=await import('../src/features/agent-search/model.mjs');
 for(const url of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','https://user:pass@example.com/','http://localhost/','http://127.1/','http://[::1]/','https://service.internal/','https://example.com:8443/','https://example.com/\n'])assert.equal(safePublicUrl(url),null,url);
 assert.equal(safePublicUrl('https://openai.com/docs'),'https://openai.com/docs');
 for(const domain of ['localhost','127.0.0.1','https://openai.com','openai.com/path','user@example.com'])assert.throws(()=>validateSearchInput({query:'q',allowed_domains:[domain]}));
 let count=0;const service=createWebSearch({model:'fixture',client:{responses:{create:()=>{count++;}}}});await assert.rejects(service.search({query:'x',allowed_domains:['localhost']}));assert.equal(count,0);
});
test('original-service filters cannot invoke a provider while independent filters remain available',async()=>{
 const {safePublicUrl,validateSearchInput}=await import('../src/features/agent-search/model.mjs');
 const domains=['tapnow.media','files.tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'];
 let calls=0;const service=createWebSearch({model:'fixture',client:{responses:{create:async()=>{calls++;return fixture();}}}});
 for(const domain of domains){
  assert.equal(safePublicUrl('https://'+domain+'/source'),null,domain);
  assert.equal(safePublicUrl('https://'+domain.toUpperCase()+'.../source'),null,domain);
  assert.throws(()=>validateSearchInput({query:'q',allowed_domains:[domain]}));
  await assert.rejects(service.search({query:'q',allowed_domains:[domain]}));
 }
 assert.equal(calls,0);
 assert.equal(safePublicUrl('https://tapnow.media.example.org/source'),'https://tapnow.media.example.org/source');
 await service.search({query:'q',allowed_domains:['openai.com']});assert.equal(calls,1);
});
test('provider original-service citations and sources are filtered without changing factual text',async()=>{
 const response=fixture(),part=response.output[1].content[0];
 part.annotations.push({type:'url_citation',url:'https://app.tapnow.media/source',title:'Original service',start_index:0,end_index:8});
 response.output[0].action.sources.push({url:'https://files.tapnow.media/source'},{url:'https://tapnow.ai/source'});
 const result=await normalizeSearchResponse(response,{query:'q',model:'fixture'});
 assert.equal(result.text,'Evidence [1]\n\nMore [2]');assert.equal(result.sources.length,2);assert.equal(result.citations.length,2);assert.equal(result.droppedSources,5);
 assert.ok(result.sources.every(source=>!source.url.includes('tapnow')));
});
test('abort rejects late provider result and unsupported errors expose no provider body/secrets',async()=>{
 let release;const controller=new AbortController(),service=createWebSearch({model:'fixture',client:{responses:{create:()=>new Promise(resolve=>{release=resolve;})}}});
 const promise=service.search({query:'q'},{signal:controller.signal});while(!release)await new Promise(resolve=>setImmediate(resolve));controller.abort();release(fixture());await assert.rejects(promise,{name:'AbortError'});
 const broken=createWebSearch({model:'fixture',client:{responses:{create:async()=>{throw Object.assign(Error('SECRET PROVIDER BODY'),{status:400});}}}});await assert.rejects(broken.search({query:'q'}),error=>error.code==='search_unsupported'&&!error.message.includes('SECRET'));
});
test('concurrent capacity stays occupied until cancelled SDK work exits',async()=>{
 let release;const controller=new AbortController(),service=createWebSearch({model:'fixture',maxConcurrent:1,client:{responses:{create:()=>new Promise(resolve=>{release=resolve;})}}});
 const pending=service.search({query:'q'},{signal:controller.signal});while(!release)await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(service.search({query:'other'}),{code:'search_capacity'});release(fixture());await assert.rejects(pending,{name:'AbortError'});
});
test('citation display preserves full factual prose and keeps overlapping and same-range sources',async()=>{
 const {citationRuns}=await import('../src/features/agent-search/model.mjs');
 const text='The bridge opened in 2025. 中文事实完整保留。',sources=[{id:'a'},{id:'b'},{id:'c'}];
 const runs=citationRuns(text,[{sourceId:'a',start_index:0,end_index:25},{sourceId:'b',start_index:0,end_index:25},{sourceId:'a',start_index:0,end_index:25},{sourceId:'c',start_index:12,end_index:text.length},{sourceId:'b',start_index:2,end_index:15}],sources);
 assert.equal(runs.map(run=>run.text).join(''),text);
 assert.deepEqual(runs.filter(run=>run.sources.length).map(run=>run.sources.map(source=>source.id)),[['b'],['a','b'],['c']]);
 assert.equal(runs[0].text,text.slice(0,15));assert.equal(runs[1].text,text.slice(15,25));
});
