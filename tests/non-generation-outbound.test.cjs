'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{Readable}=require('node:stream'),OpenAI=require('openai');
const {createConfiguredModelClient,protectModelClient}=require('../server/outbound-client.cjs');
const {AgentRuntime}=require('../server/agent.cjs');
const {streamedResponse}=require('../server/agent-stream.cjs');
const {compactContext}=require('../server/agent-compaction.cjs');
const {transcribeRequest}=require('../server/voice.cjs');
const {generateArtifactHtml}=require('../server/agent-artifacts.cjs');
const {createWebSearch}=require('../server/agent-search.cjs');
const {createVideoSegmentationAdapter}=require('../server/video-segmentation.cjs');
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const response=text=>({status:'completed',output_text:text,output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
const source={artifact_path:'artifacts/brainstorm.md',title:'本机测试',content:'测试用户内容',revision:1};
const voice=()=>Object.assign(Readable.from([Buffer.from('synthetic audio bytes')]),{headers:{'content-type':'audio/webm'}});

test('operator and injected SDK original-site/recursive destinations are rejected before user data can dispatch',async()=>{
 let calls=0;
 for(const host of ['tapnow.ai','TAPNOW.AI..','api.tapnow.media','tapnow.art','conversation-service-131786869360.asia-northeast1.run.app']){
  const connection=createConfiguredModelClient({apiKey:'fixture-key',baseUrl:'https://'+host+'/v1',fetchImpl:async()=>{calls++;return json(response('must not return'));}});assert.equal(connection.client,null);assert.equal(connection.configured,false);assert.equal(connection.configurationError,'configuration_invalid');
 }
 const injected=new OpenAI({apiKey:'fixture-key',baseURL:'https://api.tapnow.ai/v1',fetch:async()=>{calls++;return json({});}});assert.equal(createConfiguredModelClient({client:injected}).configured,false);assert.throws(()=>new AgentRuntime({client:injected,model:'fixture'}),{code:'configuration_destination_forbidden'});
 assert.equal(createConfiguredModelClient({apiKey:'fixture-key',baseUrl:'http://localhost:4173/api',localPort:4173}).configured,false);assert.equal(calls,0);assert.equal(createConfiguredModelClient({baseUrl:'https://normal-provider.test/v1/'}).baseURL,'https://normal-provider.test/v1/');
});

test('normal external SDK configuration serves agent, HTML, search, voice and compaction through protected requests without mutating injected client',async()=>{
 const calls=[];
 const client=new OpenAI({apiKey:'fixture-provider-key',baseURL:'https://configured-provider.test/v1',fetch:async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/audio/transcriptions'))return json({text:'明确的语音识别结果'});
  if(url.endsWith('/responses/compact'))return json({object:'response.compaction',output:[{type:'compaction',encrypted_content:'synthetic compaction receipt'}]});
  const body=JSON.parse(options.body);
  if(body.tools?.[0]?.type==='web_search')return json({...response('实际fixture检索结果'),output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url:'https://example.org/page',title:'fixture source'}]}},...response('实际fixture检索结果').output]});
  if(body.max_output_tokens===12000)return json(response('<!doctype html><html><body>明确fixture HTML</body></html>'));
  return json(response('明确fixture Agent结果'));
 }});
 const sharedFetch=client.fetch,connection=createConfiguredModelClient({client});assert.equal(connection.configured,true);
 const runtime=new AgentRuntime({client:connection.client,model:'fixture'});assert.equal((await runtime.start({message:'本机用户任务'})).text,'明确fixture Agent结果');await runtime.close();
 assert.match((await generateArtifactHtml({source},{client:connection.client,model:'fixture'})).html,/fixture HTML/);
 assert.equal((await createWebSearch({client:connection.client,model:'fixture'}).search({query:'公开事实'})).status,'completed');
 assert.equal((await transcribeRequest(voice(),{client:connection.client,model:'fixture',toFile:OpenAI.toFile})).text,'明确的语音识别结果');
 await connection.client.responses.compact({model:'fixture',input:[]});
 assert.equal(calls.length,5);for(const call of calls){assert.equal(call.options.redirect,'error');assert.equal(call.options.headers instanceof Headers?call.options.headers.get('authorization'):call.options.headers.Authorization,'Bearer fixture-provider-key');}assert.equal(client.fetch,sharedFetch);
 const mock={responses:{create:async()=>response('plain mock')}};assert.equal(protectModelClient(mock),mock);
});

test('real provider redirect never reaches its replacement and has one original POST',async t=>{
 let replacement=0,posts=0;
 const target=http.createServer((req,res)=>{replacement++;res.end('{}');});await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
 const provider=http.createServer((req,res)=>{posts++;res.writeHead(307,{Location:'http://127.0.0.1:'+target.address().port+'/v1/responses'});res.end();});await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await Promise.all([new Promise(resolve=>provider.close(resolve)),new Promise(resolve=>target.close(resolve))]);});
 const connection=createConfiguredModelClient({apiKey:'local-fixture-private',baseUrl:'http://127.0.0.1:'+provider.address().port+'/v1'});
 await assert.rejects(connection.client.responses.create({model:'fixture',input:'user-content-must-not-redirect'}),error=>error.code==='provider_request_failed'&&!error.message.includes('local-fixture-private'));assert.equal(posts,1);assert.equal(replacement,0);
});

test('Key echoes in Agent result, voice, HTML, search and compaction are rejected before public output or durable provider output',async()=>{
 const secret='fixture"\\private';
 for(const kind of ['agent','voice','html','search','compact']){
  const client={apiKey:secret,responses:{create:async()=>response(kind==='html'?'<html>'+secret+'</html>':secret),compact:async()=>({object:'response.compaction',output:[{type:'compaction',encrypted_content:secret}]})},audio:{transcriptions:{create:async()=>({text:secret})}}};
  if(kind==='agent'){
   const records=[],store={ready:Promise.resolve(),list:async()=>[],put:async record=>records.push(record)},runtime=new AgentRuntime({client,model:'fixture',sessionStore:store,providerIdentity:'fixture'});
   await assert.rejects(runtime.start({message:'safe user input'}),{code:'provider_response_rejected'});assert.ok(!JSON.stringify(records).includes(JSON.stringify(secret).slice(1,-1)));await runtime.close();
  }else if(kind==='voice')await assert.rejects(transcribeRequest(voice(),{client,model:'fixture',toFile:async value=>value}),{code:'provider_response_rejected'});
  else if(kind==='html')await assert.rejects(generateArtifactHtml({source},{client,model:'fixture'}),{code:'provider_response_rejected'});
  else if(kind==='search')await assert.rejects(createWebSearch({client,model:'fixture'}).search({query:'public query'}),error=>error.code==='search_failed'&&!error.message.includes(secret));
  else await assert.rejects(protectModelClient(client).responses.compact({model:'fixture',input:[]}),{code:'provider_response_rejected'});
 }
});

test('stream Key split across deltas stops before disclosure while normal tools, reasoning and text remain intact',async()=>{
 const secret='stream-private-value',events=[],controller={aborted:false,abort(){this.aborted=true;}};
 const leaking={apiKey:secret,responses:{create:async()=>({controller,async *[Symbol.asyncIterator](){yield {type:'response.output_text.delta',delta:'safe text '+secret.slice(0,7)};yield {type:'response.output_text.delta',delta:secret.slice(7)};yield {type:'response.completed',response:response(secret)};}})}};
 await assert.rejects(streamedResponse(leaking,{}, {onEvent:value=>events.push(value)}),{code:'provider_response_rejected'});assert.ok(!events.filter(e=>e.type==='text_delta').map(e=>e.delta).join('').includes(secret));assert.equal(controller.aborted,true);
 const completed={status:'completed',output_text:'明确fixture流式文字',output:[{type:'function_call',call_id:'fixture-call',name:'canvas_read',arguments:'{}'}]},normalEvents=[];
 const clean={apiKey:secret,responses:{create:async()=>({controller:{abort(){}},async *[Symbol.asyncIterator](){yield {type:'response.output_item.added',item:{type:'reasoning',id:'reason-1'}};yield {type:'response.output_text.delta',delta:'明确fixture'};yield {type:'response.output_text.delta',delta:'流式文字'};yield {type:'response.output_item.done',item:{type:'reasoning',id:'reason-1'}};yield {type:'response.completed',response:completed};}})}};
 assert.deepEqual(await streamedResponse(clean,{}, {onEvent:value=>normalEvents.push(value)}),completed);assert.equal(normalEvents.filter(e=>e.type==='text_delta').map(e=>e.delta).join(''),'明确fixture流式文字');assert.deepEqual(normalEvents.filter(e=>e.type==='thinking').map(e=>e.active),[true,false]);
});

test('stream cancellation aborts transport and never flushes held secret prefix',async()=>{
 const signal=new AbortController(),events=[],controller={aborted:false,abort(){this.aborted=true;}},client={apiKey:'cancel-private-value',responses:{create:async()=>({controller,async *[Symbol.asyncIterator](){yield {type:'response.output_text.delta',delta:'cancel-pri'};signal.abort();yield {type:'response.output_text.delta',delta:'vate-value'};}})}};
 await assert.rejects(streamedResponse(client,{}, {signal:signal.signal,onEvent:event=>events.push(event)}));assert.equal(controller.aborted,true);assert.equal(events.filter(e=>e.type==='text_delta').map(e=>e.delta).join(''),'');
});

test('segmentation uses shared destination rules and never follows a credential-echoed result link',async()=>{
 const request={kind:'video.segment',nodeId:'video-node',sourceVideoUrl:'data:video/mp4;base64,dmlkZW8=',width:4,height:2,duration:1,time:.5,selection:{x:0,y:0,width:.5,height:1},pointPrompts:[{x:1,y:1,time:.5,label:1}]};
 let calls=0;const secret='segmentation-private',adapter=createVideoSegmentationAdapter({baseUrl:'https://configured-mask.test/api',apiKey:secret,fetchImpl:async()=>{calls++;return json({width:4,height:2,rleUrl:'/mask?key='+secret});}});
 await assert.rejects(adapter.segment(request),error=>error.code==='segmentation_unknown'&&!error.message.includes(secret));assert.equal(calls,1);
 const forbidden=createVideoSegmentationAdapter({baseUrl:'https://mask.tapnow.media/api',fetchImpl:()=>assert.fail()});assert.equal(forbidden.config().configured,false);
});

test('injected SDK key callbacks retain authentication and dynamic bearer echoes are rejected',async()=>{
 const secret='dynamic-private-fixture',client=new OpenAI({apiKey:async()=>secret,baseURL:'https://dynamic-provider.test/v1',fetch:async(_url,options)=>{assert.equal(options.headers instanceof Headers?options.headers.get('authorization'):options.headers.Authorization,'Bearer '+secret);return json(response(secret));}});
 const initialKey=client.apiKey,protectedClient=protectModelClient(client);await assert.rejects(protectedClient.responses.create({model:'fixture',input:'normal user content'}),{code:'provider_response_rejected'});assert.equal(client.apiKey,initialKey);
});

test('percent-encoded Key in search citations and cross-delta text cannot become a public result',async()=>{
 const secret='review-fixture+/=private',encoded=encodeURIComponent(secret),allEncoded=Buffer.from(secret).toString('hex').match(/../g).map(byte=>'%'+byte).join(''),url='https://example.org/page?key='+encoded;
 const client=new OpenAI({apiKey:secret,baseURL:'https://configured-encoded-provider.test/v1',fetch:async()=>json({status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[{url}]}},...response('fixture result').output]})});
 await assert.rejects(createWebSearch({client,model:'fixture'}).search({query:'public query'}),error=>error.code==='search_failed'&&!error.message.includes(secret));
 for(const value of [encoded,encoded.toLowerCase(),allEncoded]){
  const publicEvents=[],provider={apiKey:secret,responses:{create:async()=>({controller:{abort(){}},async *[Symbol.asyncIterator](){for(let start=0;start<value.length;start+=4)yield {type:'response.output_text.delta',delta:value.slice(start,start+4)};yield {type:'response.completed',response:response('otherwise clean completed response')};}})}};
  await assert.rejects(streamedResponse(provider,{}, {onEvent:event=>publicEvents.push(event)}),{code:'provider_response_rejected'});assert.ok(!publicEvents.filter(event=>event.type==='text_delta').map(event=>event.delta).join('').includes(value));
 }
});
