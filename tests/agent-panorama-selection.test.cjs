'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parse}=require('../agent-tools.js');
const args={kind:'image.generate',nodeId:'source',prompt:'保留白模空间布局',model:'hunyuan-world-panorama',aspect:'2:1',isPanoramaPrompt:true,count:1,referenceIds:['source']};
test('panorama selection is explicit schema data and cannot be attached to another generation kind',()=>{
 assert.equal(parse('generation_submit',args).args.isPanoramaPrompt,true);
 assert.equal(parse('generation_submit',{...args,isPanoramaPrompt:false}).args.isPanoramaPrompt,false);
 assert.throws(()=>parse('generation_submit',{...args,isPanoramaPrompt:'true'}));
 for(const kind of ['video.generate','image.upscale','image.multiAngle','audio.generate'])assert.throws(()=>parse('generation_submit',{...args,kind}));
});
test('actual Agent generation dispatcher carries panorama flag/model/aspect and one reference without implicit conversion',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'..','agent-client.js'),'utf8'),start=source.indexOf("  case 'generation_submit':{"),end=source.indexOf("  case 'scene_import':",start);
 const fragment=source.slice(start,end).replace(/await import\('([^']+)'\)/g,(_all,specifier)=>"await modules("+JSON.stringify(specifier)+")");
 const node={id:'source',type:'image',image:'local-thumbnail',fullImage:'local-real-source'},sent=[];
 const {prepareAgentMediaInputs}=await import('../src/features/agent-generation/media-inputs.mjs'),{prepareNativePanoramaRequest}=await import('../src/features/image-generation/panorama-native.mjs');
 const png=fs.readFileSync(path.resolve(__dirname,'..','qa/agent-image-processing-source.png')),inputUrl='data:image/png;base64,'+png.toString('base64');
 const context={app:{getState:()=>({nodes:[node]})},window:{GenerationAPI:{availability:async()=>({configured:true}),submit:(request,options)=>{sent.push({request,options});return {id:'fixture-task',status:'queued'};}}},document:{baseURI:'http://localhost:4173/'},modules:async name=>name.endsWith('image-processing.mjs')?import('../src/features/agent-generation/image-processing.mjs'):name.endsWith('media-inputs.mjs')?{prepareAgentMediaInputs:async(refs,options)=>{assert.equal(refs.length,1);assert.equal(options.panoramaModel,args.model);return prepareAgentMediaInputs(refs,{...options,resolveMedia:async source=>{assert.equal(source.fullImage,'local-real-source');return {id:source.id,type:'image',url:inputUrl,width:png.readUInt32BE(16),height:png.readUInt32BE(20)};}});}}:assert.fail('unexpected module '+name)};
 vm.runInNewContext('async function dispatch(a){const signal=undefined,onDepthSubmitted=()=>{};switch("generation_submit"){'+fragment+'}}',context);
 await context.dispatch(parse('generation_submit',args).args);assert.equal(sent.length,1);const first=sent[0].request;assert.equal(first.parameters.isPanoramaPrompt,true);assert.equal(first.parameters.model,'hunyuan-world-panorama');assert.equal(first.parameters.aspect,'2:1');assert.equal(first.parameters.count,1);assert.equal(first.inputs.length,1);assert.deepEqual(Object.keys(first.inputs[0]),['type','id','url','width','height']);assert.equal(first.inputs[0].width,512);assert.equal(first.inputs[0].height,320);
 const normalized={...first,parameters:Object.fromEntries(Object.entries(first.parameters).filter(([,value])=>value!==undefined))};assert.equal(prepareNativePanoramaRequest(normalized).parameters.isPanoramaPrompt,true);
 sent[0].options.beforeDispatch();node.fullImage='changed-source';assert.throws(sent[0].options.beforeDispatch,/修改或替换/);node.fullImage='local-real-source';node.crop={x:0,y:0,width:12,height:12};assert.throws(sent[0].options.beforeDispatch,/修改或替换/);delete node.crop;
 await context.dispatch(parse('generation_submit',{...args,isPanoramaPrompt:false}).args);assert.equal(sent[1].request.parameters.isPanoramaPrompt,false);
 const ordinary={...args};delete ordinary.isPanoramaPrompt;await context.dispatch(parse('generation_submit',ordinary).args);assert.equal(Object.hasOwn(sent[2].request.parameters,'isPanoramaPrompt'),false);
});
test('panorama canonicalization refuses unmeasured inputs and retains node identity guard',async()=>{
 const {prepareAgentMediaInputs}=await import('../src/features/agent-generation/media-inputs.mjs');let node={id:'source',type:'image',image:'original'};
 const options={getNode:()=>node,deferTransport:true,panoramaModel:args.model,resolveMedia:async()=>({type:'image',id:'source',url:'local-real-image'})};await assert.rejects(prepareAgentMediaInputs([node],options),/真实像素尺寸/);
 const prepared=await prepareAgentMediaInputs([node],{...options,resolveMedia:async()=>({type:'image',id:'source',url:'local-real-image',width:512,height:320})});prepared.guard();node={...node};assert.throws(prepared.guard,/修改或替换/);
});
