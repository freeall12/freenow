'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const alias='hunyuan-world-panorama';
const metadata={protocol:'fal-panorama-native',configured:true,capabilities:{kinds:['image.generate'],models:{[alias]:{kind:'image.generate'}},panorama:{[alias]:{source:'image',maxImages:1,maxCount:1,projection:'equirectangular',fixedAspectRatio:'2:1',nativeSize:true,editing:false}}}};
const request=()=>({kind:'image.generate',prompt:'还原完整房间的全景',inputs:[{type:'image',nodeId:'source',url:'asset:original',width:20,height:10}],parameters:{modelId:alias,isPanoramaPrompt:true,ratio:'2:1',count:1}});
const inline='data:image/png;base64,YQ==';
const moduleReady=import('../src/features/image-generation/panorama-media.mjs');

test('native panorama checks exact configuration before resolving or decoding source bytes',async()=>{
 const {preparePanoramaMedia}=await moduleReady;
 for(const config of [null,{...metadata,configured:false},{...metadata,protocol:'tasks-v1'}])await assert.rejects(()=>preparePanoramaMedia(request(),{nativeConfiguration:config,resolveMedia:()=>assert.fail('configuration must precede media read')}));
 const ordinary={...request(),parameters:{modelId:'another-image-model'}};
 assert.equal(await preparePanoramaMedia(ordinary,{resolveMedia:()=>assert.fail()}),ordinary);
});

test('source identity guards bound actual pixels through inline transport and retain original dimensions',async()=>{
 const {preparePanoramaMedia}=await moduleReady;const original=request(),calls=[];let checks=0;
 const value=await preparePanoramaMedia(original,{nativeConfiguration:metadata,baseUrl:'http://localhost:4173/',validateSources:()=>checks++,resolveMedia:async(node,options)=>{calls.push('resolve');assert.equal(node.image,'asset:original');assert.equal(options.decodeImage,false);return {url:'blob:http://localhost:4173/source'};},transport:async(input,options)=>{calls.push('transport');assert.equal(options.inlineImages,true);assert.equal(options.maxMediaBytes,20*1024*1024);options.validateSources();return {...input,inputs:[{...input.inputs[0],url:inline}]};},encode:async(url,options)=>{calls.push('encode');assert.equal(url,inline);options.validateSources();return {url:inline,width:4096,height:2048};}});
 assert.deepEqual(calls,['resolve','transport','encode']);assert.ok(checks>=6);
 assert.equal(value.inputs[0].width,4096);assert.equal(value.inputs[0].height,2048);assert.equal(value.inputs[0].nodeId,'source');
 assert.deepEqual(original,request());
});

test('source replacement, cancellation and original service URLs stop before the next media operation',async()=>{
 const {preparePanoramaMedia}=await moduleReady;let current=true,release;
 const wait=new Promise(resolve=>release=resolve);
 const pending=preparePanoramaMedia(request(),{nativeConfiguration:metadata,baseUrl:'http://localhost:4173/',validateSources:()=>{if(!current)throw Error('source changed');},resolveMedia:()=>wait,transport:()=>assert.fail('stale source cannot be read')});
 current=false;release({url:inline});await assert.rejects(pending,/source changed/);
 const controller=new AbortController();let releaseEncode;const encoded=new Promise(resolve=>releaseEncode=resolve);
 const cancelled=preparePanoramaMedia(request(),{signal:controller.signal,nativeConfiguration:metadata,resolveMedia:async()=>({url:inline}),transport:async input=>input,encode:()=>encoded});
 controller.abort(Error('cancelled'));releaseEncode({url:inline,width:4,height:2});await assert.rejects(cancelled,/cancelled/);
 for(const url of ['https://files.tapnow.media/image.png','https://user:password@media.test/image.png'])await assert.rejects(()=>preparePanoramaMedia(request(),{nativeConfiguration:metadata,resolveMedia:async()=>({url}),transport:()=>assert.fail('forbidden source cannot be fetched')}));
});

function pixelFixture({width=1536,height=1024,bytes=12}={}){
 const canvas={width:0,height:0,getContext:()=>({drawImage:(image,x,y)=>{assert.equal(image.naturalWidth,width);assert.equal(image.naturalHeight,height);assert.equal(x,0);assert.equal(y,0);}}),toBlob(callback,mime){assert.equal(this.width,width);assert.equal(this.height,height);assert.equal(mime,'image/png');callback(new Blob([new Uint8Array(bytes)],{type:mime}));}};
 const image={naturalWidth:width,naturalHeight:height,set src(value){assert.equal(value,inline);queueMicrotask(()=>this.onload?.());},removeAttribute(){}};
 return {canvas,image};
}
test('PNG conversion preserves original pixel dimensions and rejects oversize data without scaling',async()=>{
 const {encodePanoramaSource}=await moduleReady;
 const {canvas,image}=pixelFixture();let calls=0;
 const output=await encodePanoramaSource(inline,{createImage:()=>image,createCanvas:()=>canvas,serialize:async blob=>{calls++;assert.equal(blob.type,'image/png');return inline;}});
 assert.deepEqual(output,{url:inline,width:1536,height:1024});assert.equal(calls,1);assert.equal(canvas.width,0);
 const huge=pixelFixture({width:8192,height:8192});await assert.rejects(()=>encodePanoramaSource(inline,{createImage:()=>huge.image,createCanvas:()=>assert.fail('oversize source cannot allocate a canvas')}),/32M/);
 const oversized=pixelFixture({bytes:20*1024*1024+1});await assert.rejects(()=>encodePanoramaSource(inline,{createImage:()=>oversized.image,createCanvas:()=>oversized.canvas,serialize:()=>assert.fail('oversize source cannot serialize')}),/20 MiB/);
 await assert.rejects(()=>encodePanoramaSource('data:image/svg+xml;base64,YQ==',{createImage:()=>assert.fail('unsupported codecs cannot decode')}),/PNG/);
});

test('a stalled final PNG reader times out and aborts its pending serialization',async()=>{
 const {encodePanoramaSource}=await moduleReady,{image,canvas}=pixelFixture();let readerSignal;
 await assert.rejects(()=>encodePanoramaSource(inline,{createImage:()=>image,createCanvas:()=>canvas,timeoutMs:5,serialize:(_blob,{signal})=>{readerSignal=signal;return new Promise(()=>{});}}),/序列化超时/);
 assert.equal(readerSignal.aborted,true);
});
