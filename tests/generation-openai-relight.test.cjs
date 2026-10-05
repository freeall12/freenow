'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deflateSync}=require('node:zlib');
const {createOpenAIRelightProvider,parseOpenAIRelightModelMap,MAX_RESPONSE_BYTES}=require('../server/generation-openai-relight.cjs');
const {encodeRGBA,decodePNG,crc32}=require('../server/generation-png-alpha.cjs');
const key='synthetic-openai-relight-contract-key';
const source=encodeRGBA(13,9,Buffer.alloc(13*9*4,255)),sourceUrl='data:image/png;base64,'+source.toString('base64');
const output=encodeRGBA(16,10,Buffer.alloc(16*10*4,220)),outputB64=output.toString('base64');
const profile=extra=>({kind:'image.relight',model:'gpt-image-2',semantics:'parameter-prompt-edit',quality:'high',outputSize:'auto',...extra});
const request={kind:'image.relight',label:'打光',nodeId:'result',sourceNodeId:'source',prompt:'',inputs:[{type:'image',role:'source_image',nodeId:'source',url:sourceUrl,width:13,height:9}],parameters:{angle:{preset:'front_0'},brightnessPercent:50,temperatureK:5600,rimEnabled:true,rimPreset:'back_0'}};
const provider=extra=>createOpenAIRelightProvider({apiKey:key,modelMap:{'image.relight':profile()},client:{images:{edit:async()=>({data:[{b64_json:outputB64}]})}},...extra});
const changed=parameters=>({...request,parameters:{...request.parameters,...parameters}});
const response=(data=[{b64_json:outputB64}],headers={},status=200)=>new Response(JSON.stringify({data}),{status,headers:{'content-type':'application/json',...headers}});
const instructions=body=>JSON.parse(body.prompt.slice(body.prompt.indexOf('\n')+1));
function withChunk(bytes,type,metadata){
 const chunk=Buffer.alloc(metadata.length+12);chunk.writeUInt32BE(metadata.length);chunk.write(type,4);metadata.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);
 return Buffer.concat([bytes.subarray(0,33),chunk,bytes.subarray(33)]);
}
const withExif=(bytes,metadata)=>withChunk(bytes,'eXIf',metadata);

test('complete published lighting contract equals the authoritative core, including exact rim eligibility',async()=>{
 const core=await import('../image-relight-core.mjs'),native=provider(),caps=native.metadata.capabilities.relight;
 assert.deepEqual(caps.anglePresets,core.anglePresets);assert.equal(caps.anglePresets.length,26);
 assert.deepEqual(caps.brightnessPercent,core.brightnessStops);assert.deepEqual(caps.temperatureK,core.temperatureStops);assert.deepEqual(caps.rimPresets,core.rimPresets);
 assert.deepEqual([...caps.rimEligibleAngles].sort(),core.anglePresets.filter(p=>core.rimAllowed(p.azimuthDeg,p.elevationDeg)).map(p=>p.key).sort());assert.equal(caps.rimEligibleAngles.length,10);
 assert.equal(caps.semantics,'parameter-prompt-edit');assert.equal(caps.sizePolicy,'provider-native-output');assert.equal(caps.preservesSourceBytes,true);
 for(const property of ['physicalLightingGuaranteed','tapNowEquivalent','aspectMatchGuaranteed','promptEditable'])assert.equal(caps[property],false);
  assert.deepEqual(caps.inputMimeTypes,['image/png']);assert.equal(caps.maxCount,1);assert.equal(caps.maxInputImages,1);
 assert.deepEqual(caps.rejectedPNGMetadataChunks,['zTXt','iTXt','iCCP']);
 assert.equal(native.poll,undefined);assert.equal(native.cancel,undefined);assert.equal(native.isPollable(),false);
 assert.equal(native.metadata.capabilities.remoteRecovery,false);assert.equal(native.metadata.capabilities.remoteCancellation,false);
 assert.equal(native.fingerprint,provider({apiKey:'rotated-contract-key'}).fingerprint);assert.equal(JSON.stringify(native.metadata).includes(key),false);
});

test('installed SDK multipart sends untouched original pixels, all explicit defaults, auto size and one edit POST',async()=>{
 let calls=0;
 const native=provider({client:undefined,fetchImpl:async(url,options)=>{
  calls++;assert.equal(String(url),'https://api.openai.com/v1/images/edits');assert.equal(options.redirect,'error');
  assert.equal(new Headers(options.headers).get('authorization'),'Bearer '+key);assert.equal(new Headers(options.headers).get('accept-encoding'),'identity');
  const form=await new Request(url,{...options,duplex:'half'}).formData(),images=form.getAll('image[]');
  assert.equal(images.length,1);assert.equal(images[0].name,'source.png');assert.equal(images[0].type,'image/png');assert.deepEqual(Buffer.from(await images[0].arrayBuffer()),source);
  for(const [field,value]of Object.entries({model:'gpt-image-2',size:'auto',quality:'high',n:'1',output_format:'png',stream:'false'}))assert.equal(form.get(field),value);
  for(const field of ['mask','input_fidelity','response_format'])assert.equal(form.get(field),null);
  const compiled=instructions({prompt:form.get('prompt')});
  assert.equal(form.get('prompt').includes('TapNow'),false);
  assert.equal(compiled.mainLight.preset,'front_0');assert.equal(compiled.mainLight.azimuthDeg,0);assert.equal(compiled.mainLight.elevationDeg,0);
  assert.equal(compiled.mainLight.brightnessPercent,50);assert.equal(compiled.mainLight.temperatureK,5600);assert.deepEqual(compiled.source.widthPx,13);
  assert.equal(compiled.rimLight.enabled,true);assert.equal(compiled.rimLight.preset,'back_0');assert.equal(compiled.rimLight.azimuthDeg,180);assert.equal(compiled.rimLight.elevationDeg,0);
  return response();
 }});
 const before=structuredClone(request),result=await native.submit(request);assert.deepEqual(request,before);
 assert.equal(result.status,'succeeded');assert.deepEqual(result.outputs,[{type:'image',url:'data:image/png;base64,'+outputB64,width:16,height:10}]);assert.equal(calls,1);
 assert.equal(decodePNG(source).width,13);assert.notEqual(result.outputs[0].width,13);
});

test('every core angle, brightness, Kelvin and both rim states is compiled without parameter loss',async()=>{
 const core=await import('../image-relight-core.mjs');let posted,calls=0;
 const native=provider({client:{images:{edit:async body=>{posted=body;calls++;return {data:[{b64_json:outputB64}]};}}}});
 for(const angle of core.anglePresets){
  await native.submit(changed({angle:{preset:angle.key},rimEnabled:false,rimPreset:'low_back_45'}));const compiled=instructions(posted);
  assert.deepEqual([compiled.mainLight.preset,compiled.mainLight.azimuthDeg,compiled.mainLight.elevationDeg],[angle.key,angle.azimuthDeg,angle.elevationDeg]);
  assert.equal(compiled.rimLight.enabled,false);assert.equal(compiled.rimLight.preset,'low_back_45');assert.equal(compiled.rimLight.elevationDeg,-45);assert.match(compiled.rimLight.instruction,/Do not add/);
 }
 for(const brightnessPercent of core.brightnessStops)for(const temperatureK of core.temperatureStops){await native.submit(changed({brightnessPercent,temperatureK}));const compiled=instructions(posted);assert.equal(compiled.mainLight.brightnessPercent,brightnessPercent);assert.equal(compiled.mainLight.temperatureK,temperatureK);}
 for(const [rimPreset,rim]of Object.entries(core.rimPresets)){await native.submit(changed({rimPreset}));const compiled=instructions(posted);assert.equal(compiled.rimLight.enabled,true);assert.equal(compiled.rimLight.preset,rimPreset);assert.equal(compiled.rimLight.azimuthDeg,rim.azimuthDeg);assert.equal(compiled.rimLight.elevationDeg,rim.elevationDeg);}
 assert.equal(calls,47);
});

test('model map requires exact kind alias and explicit semantic, size and quality opt-in',async()=>{
 for(const modelMap of [{alias:profile()},{'image.relight':profile({kind:'image.generate'})},{'image.relight':profile({model:'gpt-image-2.5-flare'})},{'image.relight':profile({semantics:undefined})},{'image.relight':profile({semantics:'physical-relight'})},{'image.relight':profile({quality:undefined})},{'image.relight':profile({outputSize:undefined})},{'image.relight':profile({outputSize:'source'})},{'image.relight':profile({maxCount:2})}])assert.throws(()=>parseOpenAIRelightModelMap(modelMap));
 for(const options of [{modelMap:{}},{apiKey:'',client:undefined},{apiKey:'bad\nkey'},{baseUrl:'https://tapnow.media/v1'},{baseUrl:'https://api.openai.com/v1',client:{baseURL:'https://other.example/v1'}},{modelMap:{'image.relight':profile({model:key})}}]){const native=provider(options);assert.equal(native.configured,false);assert.throws(()=>native.prepare(request),{code:'configuration_required'});assert.equal(JSON.stringify(native.metadata).includes(key),false);}
 const native=provider({modelMap:{'image.relight':profile({model:'gpt-image-2-2026-04-21'})}});assert.equal(native.prepare(request),request);
 assert.notEqual(native.fingerprint,provider({modelMap:{'image.relight':profile({quality:'low'})}}).fingerprint);
});

test('invalid and extra lighting fields, image identity, roles, formats and counts fail before any SDK dispatch',async()=>{
 let calls=0;const native=provider({client:{images:{edit:()=>{calls++;assert.fail();},generate:()=>assert.fail()}}});
 for(const p of [{angle:{preset:'back_180'}},{angle:{preset:'front_0',azimuthDeg:0}},{angle:{preset:'unknown'}},{brightnessPercent:0},{brightnessPercent:'50'},{temperatureK:5500},{rimEnabled:'false'},{rimPreset:'back'},{model:'image.relight'},{times:1},{quality:'high'},{providerParameters:{}},{brightnessPercent:undefined}])await assert.rejects(native.submit(changed(p)),{code:'unsupported_generation'});
 const core=await import('../image-relight-core.mjs');
 for(const angle of core.anglePresets.filter(p=>!core.rimAllowed(p.azimuthDeg,p.elevationDeg)))await assert.rejects(native.submit(changed({angle:{preset:angle.key},rimEnabled:true})),{code:'unsupported_generation'});
 for(const delta of [{kind:'image.generate'},{prompt:' '},{prompt:'make this brighter'},{count:2},{count:'1'},{vendor:{}},{references:[request.inputs[0]]},{inputs:[]},{inputs:[request.inputs[0],request.inputs[0]]},{inputs:[{...request.inputs[0],role:undefined}]},{inputs:[{...request.inputs[0],role:'reference_image'}]},{inputs:[{...request.inputs[0],mask:sourceUrl}]},{inputs:[{...request.inputs[0],url:'asset:source'}]},{inputs:[{...request.inputs[0],url:'blob:http://localhost/source'}]},{inputs:[{...request.inputs[0],url:'https://example.test/source.png'}]},{inputs:[{...request.inputs[0],width:14}]},{sourceNodeId:'other'}])await assert.rejects(native.submit({...request,...delta}),{code:'unsupported_generation'});
 const damaged=Buffer.from(source);damaged[damaged.length-1]^=1;
 for(const bytes of [damaged,source.subarray(0,-1),Buffer.concat([source,Buffer.from('extra')])])await assert.rejects(native.submit({...request,inputs:[{...request.inputs[0],url:'data:image/png;base64,'+bytes.toString('base64')}]}),{code:'unsupported_generation'});
 await assert.rejects(native.submit({...request,inputs:[{...request.inputs[0],url:sourceUrl.replace('image/png','image/webp')}]}),{code:'unsupported_generation'});assert.equal(calls,0);
});

test('actual PNG integrity and count are required; ambiguous or fixed-size-mismatched results remain unknown with one edit',async()=>{
 const damaged=Buffer.from(output);damaged[damaged.length-1]^=1;
 for(const data of [[],[{url:'https://example.test/result.png'}],[{b64_json:'AA=='}],[{b64_json:damaged.toString('base64')}],[{b64_json:outputB64},{b64_json:outputB64}],[{b64_json:outputB64,url:'https://example.test/result.png'}]]){
  let calls=0;await assert.rejects(provider({client:{images:{edit:async()=>{calls++;return {data};}}}}).submit(request),{code:'unknown'});assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(provider({modelMap:{'image.relight':profile({outputSize:'1024x1024'})},client:{images:{edit:async()=>{calls++;return {data:[{b64_json:outputB64}]};}}}}).submit(request),{code:'unknown'});assert.equal(calls,1);
 const fixed=encodeRGBA(1024,1024,Buffer.alloc(1024*1024*4,255));
 assert.equal((await provider({modelMap:{'image.relight':profile({outputSize:'1024x1024'})},client:{images:{edit:async()=>({data:[{b64_json:fixed.toString('base64')}]})}}}).submit(request)).outputs[0].width,1024);
});

test('official SDK definite rejection is failed, transport ambiguity and spoofed status are unknown without retries',async()=>{
 for(const status of [400,401,403,404,422,429]){let calls=0;const native=provider({client:undefined,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:{message:'vendor private detail'}}),{status,headers:{'content-type':'application/json'}});}});const result=await native.submit(request);assert.equal(result.status,'failed');assert.equal(result.code,'provider_rejected');assert.equal(JSON.stringify(result).includes('vendor private detail'),false);assert.equal(calls,1);}
 for(const status of [408,409,500]){let calls=0;await assert.rejects(provider({client:undefined,fetchImpl:async()=>{calls++;return new Response('{"error":{"message":"uncertain"}}',{status,headers:{'content-type':'application/json'}});}}).submit(request),{code:'unknown'});assert.equal(calls,1);}
 await assert.rejects(provider({client:{images:{edit:async()=>{throw Object.assign(Error('spoof'),{status:400});}}}}).submit(request),{code:'unknown'});
});

test('bounded response MIME, encoding, length and credential echoes reject without retry or public leakage',async()=>{
 for(const headers of [{'content-type':'text/html'},{'content-encoding':'gzip'},{'content-length':'1'},{'content-length':'0'},{'content-length':String(MAX_RESPONSE_BYTES+1)}]){let calls=0;await assert.rejects(provider({client:undefined,fetchImpl:async()=>{calls++;return response(undefined,headers);}}).submit(request),{code:'unknown'});assert.equal(calls,1);}
 for(const value of [{data:[{b64_json:outputB64}],usage:{echo:key}},{error:{message:key}}])await assert.rejects(provider({client:undefined,fetchImpl:async()=>new Response(JSON.stringify(value),{status:value.error?400:200,headers:{'content-type':'application/json'}})}).submit(request),e=>e.code==='unknown'&&!e.message.includes(key));
 await assert.rejects(provider({client:{apiKey:'injected-contract-key',images:{edit:async()=>({data:[{b64_json:outputB64}],usage:{echo:'injected-contract-key'}})}}}).submit(request),e=>e.code==='unknown'&&!e.message.includes('injected-contract-key'));
 const native=provider({client:{images:{edit:()=>assert.fail()}}});assert.throws(()=>native.prepare({...request,label:key}));
});

test('valid PNG ancillary credential echoes in UTF16LE/BE at either alignment reject sources before dispatch and results as unknown',async()=>{
 for(const encoding of ['utf16le','utf16be'])for(const offset of [0,1]){
  const encoded=Buffer.from(key,'utf16le');if(encoding==='utf16be')encoded.swap16();
  const metadata=Buffer.concat([Buffer.alloc(offset),encoded]),sourceEcho=withExif(source,metadata),outputEcho=withExif(output,metadata);
  assert.equal(decodePNG(sourceEcho).width,13);assert.equal(decodePNG(outputEcho).width,16);
  let sourceCalls=0;
  const sourceProvider=provider({client:{images:{edit:async()=>{sourceCalls++;return {data:[{b64_json:outputB64}]};}}}});
  await assert.rejects(sourceProvider.submit({...request,inputs:[{...request.inputs[0],url:'data:image/png;base64,'+sourceEcho.toString('base64')}]}),error=>error.code==='provider_response_rejected'&&!error.message.includes(key));assert.equal(sourceCalls,0);
  let resultCalls=0;
  const resultProvider=provider({client:{images:{edit:async()=>{resultCalls++;return {data:[{b64_json:outputEcho.toString('base64')}]};}}}});
  await assert.rejects(resultProvider.submit(request),error=>error.code==='unknown'&&!error.message.includes(key));assert.equal(resultCalls,1);
 }
 const injectedKey='injected-utf16-contract-key',encoded=Buffer.from(injectedKey,'utf16le').swap16(),outputEcho=withExif(output,encoded);
 await assert.rejects(provider({client:{apiKey:injectedKey,images:{edit:async()=>({data:[{b64_json:outputEcho.toString('base64')}]})}}}).submit(request),error=>error.code==='unknown'&&!error.message.includes(injectedKey));
});

test('unreviewed compressed PNG metadata is rejected for both sources and results, including compressed credential echoes',async()=>{
 const compressed=deflateSync(Buffer.from(key));
 for(const [type,prefix]of [['zTXt',Buffer.from('note\0\0')],['iTXt',Buffer.from('note\0\x01\0\0\0')],['iCCP',Buffer.from('profile\0\0')]]){
  const payload=Buffer.concat([prefix,compressed]),sourceEcho=withChunk(source,type,payload),outputEcho=withChunk(output,type,payload);
  assert.equal(sourceEcho.includes(Buffer.from(key)),false);assert.equal(decodePNG(sourceEcho).width,13);assert.equal(decodePNG(outputEcho).width,16);
  let sourceCalls=0;
  await assert.rejects(provider({client:{images:{edit:async()=>{sourceCalls++;return {data:[{b64_json:outputB64}]};}}}}).submit({...request,inputs:[{...request.inputs[0],url:'data:image/png;base64,'+sourceEcho.toString('base64')}]}),error=>error.code==='unsupported_generation'&&!error.message.includes(key));assert.equal(sourceCalls,0);
  let resultCalls=0;
  await assert.rejects(provider({client:{images:{edit:async()=>{resultCalls++;return {data:[{b64_json:outputEcho.toString('base64')}]};}}}}).submit(request),error=>error.code==='unknown'&&!error.message.includes(key));assert.equal(resultCalls,1);
  const harmless=withChunk(source,type,Buffer.concat([prefix,deflateSync(Buffer.from('ordinary metadata'))]));
  assert.throws(()=>provider().prepare({...request,inputs:[{...request.inputs[0],url:'data:image/png;base64,'+harmless.toString('base64')}]}),{code:'unsupported_generation'});
 }
});

test('credential bytes hidden by IDAT compression are scanned in decoded source and result pixels',async()=>{
 const pixels=Buffer.alloc(13*9*4,255),encoded=Buffer.from(key,'utf16le').swap16();encoded.copy(pixels,1);
 const echoed=encodeRGBA(13,9,pixels);assert.equal(echoed.includes(encoded),false);assert.deepEqual(decodePNG(echoed).pixels,pixels);
 let sourceCalls=0;
 await assert.rejects(provider({client:{images:{edit:async()=>{sourceCalls++;return {data:[{b64_json:outputB64}]};}}}}).submit({...request,inputs:[{...request.inputs[0],url:'data:image/png;base64,'+echoed.toString('base64')}]}),error=>error.code==='provider_response_rejected'&&!error.message.includes(key));assert.equal(sourceCalls,0);
 let resultCalls=0;
 await assert.rejects(provider({client:{images:{edit:async()=>{resultCalls++;return {data:[{b64_json:echoed.toString('base64')}]};}}}}).submit(request),error=>error.code==='unknown'&&!error.message.includes(key));assert.equal(resultCalls,1);
});

test('abort, ignored signal, late fetch and stalled body do not manufacture recovery or repeat paid work',async()=>{
 const before=new AbortController();before.abort(Error('before submit'));await assert.rejects(provider({client:{images:{edit:()=>assert.fail()}}}).submit(request,{signal:before.signal}),/before submit/);
 let release,calls=0;const native=provider({timeoutMs:10,client:{images:{edit:()=>{calls++;return new Promise(resolve=>{release=resolve;});}}}});
 await assert.rejects(native.submit(request),{code:'unknown'});release({data:[{b64_json:outputB64}]});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(native.poll,undefined);assert.equal(native.cancel,undefined);
 let fetchRelease,lateCancelled=false,fetchCalls=0;
 await assert.rejects(provider({client:undefined,timeoutMs:10,fetchImpl:()=>{fetchCalls++;return new Promise(resolve=>{fetchRelease=resolve;});}}).submit(request),{code:'unknown'});
 fetchRelease(new Response(new ReadableStream({cancel(){lateCancelled=true;}}),{headers:{'content-type':'application/json'}}));await new Promise(resolve=>setImmediate(resolve));assert.equal(fetchCalls,1);assert.equal(lateCancelled,true);
 let bodyCancelled=false;
 await assert.rejects(provider({client:undefined,timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(Buffer.from('{')));},cancel(){bodyCancelled=true;}}),{headers:{'content-type':'application/json'}})}).submit(request),{code:'unknown'});assert.equal(bodyCancelled,true);
 const controller=new AbortController();let started;const dispatch=new Promise(resolve=>{started=resolve;});let stoppedCalls=0;
 const pending=provider({client:{images:{edit:()=>{stoppedCalls++;started();return new Promise(()=>{});}}}}).submit(request,{signal:controller.signal});await dispatch;controller.abort(Error('local stop only'));await assert.rejects(pending,/local stop only/);assert.equal(stoppedCalls,1);
});
