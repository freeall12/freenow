const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const counts=()=>import('../src/features/generation-results/counts.mjs');

test('image layout slots match official lower-slot normalization and MJ four-output requests',async()=>{
 const {imageResultCounts}=await counts();
 for(const mode of ['variants','pile','spread'])for(const isMidjourney of [false,true]){
  const expected=isMidjourney?(mode==='variants'?[1]:[1,2,3]):(mode==='variants'?[1,2,4]:[1,2,4,8,12]);
  for(const currentTimes of [-2,0,1,1.9,2,3,4,6,8,11,12,99,NaN,undefined,'8']){
   const result=imageResultCounts({mode,isMidjourney,currentTimes});assert.deepEqual(result.options,expected);
   assert.equal(result.times,[...expected].reverse().find(value=>value<=Number(currentTimes))??1);
   assert.equal(result.batchSize,isMidjourney?4:1);assert.equal(result.displayCount,result.times*result.batchSize);
  }
 }
 assert.deepEqual(imageResultCounts({mode:'invalid',currentTimes:12}).options,[1,2,4]);
 const first=imageResultCounts({mode:'spread'});first.options.pop();assert.deepEqual(imageResultCounts({mode:'spread'}).options,[1,2,4,8,12]);
});

test('video count policy preserves independent variant slots and one-output final video',async()=>{
 const {videoResultCounts}=await counts();assert.deepEqual(videoResultCounts({currentTimes:12}),{options:[1,2],times:2});
 assert.deepEqual(videoResultCounts({currentTimes:4,timesOptions:[1,3,6]}),{options:[1,3,6],times:3});
 assert.deepEqual(videoResultCounts({currentTimes:12,timesOptions:[1,3,6],final:true}),{options:[1],times:1});
 assert.deepEqual(videoResultCounts({currentTimes:3,timesOptions:[]}),{options:[1,2],times:2});
});

test('image request preparation and provider parameters retain captured mode without storage or input mutation',async()=>{
 const {prepareImageRequest}=await import('../src/features/image-generation/request.mjs'),{providerParameters,normalize,countsFor,modelFor,selectModel}=await import('../src/features/image-generation/catalog.mjs');
 for(const mode of ['pile','spread','variants'])for(const model of ['nano-banana-flash','midjourney-v7']){
  const input={kind:'image.generate',inputs:[],parameters:{model,ratio:'16:9',count:12,times:12,resultMode:mode,prompt:'保持主体与光线',camera:'Sony Venice'}};
  const before=structuredClone(input),prepared=prepareImageRequest(input),expected=model.startsWith('midjourney')?(mode==='variants'?1:3):(mode==='variants'?4:12);
  assert.deepEqual(input,before);assert.equal(prepared.parameters.count,expected);assert.equal(prepared.parameters.times,expected);assert.equal(prepared.parameters.resultMode,mode);
  assert.equal(prepared.parameters.providerParameters.times,expected);assert.equal(providerParameters(prepared.parameters).times,expected);
  assert.equal(prepared.parameters.providerParameters.resultMode,undefined,'local placement mode is not a vendor model parameter');
  assert.equal(normalize(prepared.parameters).count,expected);
 }
 assert.deepEqual(countsFor(modelFor('nano-banana-flash')),[4,2,1]);assert.deepEqual(countsFor(modelFor('nano-banana-flash'),'pile'),[12,8,4,2,1]);
 assert.equal(selectModel({model:'nano-banana-flash',resultMode:'spread',count:12,ratio:'16:9'},'midjourney-v7').count,3);
 assert.equal(prepareImageRequest({kind:'image.generate',parameters:{model:'nano-banana-flash',count:12}}).parameters.count,4);
});

test('selected editor mode event normalizes counts once while preserving prompt, references and film settings',async()=>{
 const resultCounts=await counts(),{modelFor}=await import('../src/features/image-generation/catalog.mjs');
 const source=fs.readFileSync(require.resolve('../node-editor.js'),'utf8'),config={model:'nano-banana-flash',count:12,times:12,resultMode:'spread',prompt:'雨夜追焦',refs:['asset:a'],quality:'4K',camera:'Sony Venice',lens:'Zeiss Ultra Prime'};
 const calls={save:0,close:0,footer:0,position:0},context={resultCounts,resultMode:'spread',node:{id:'n',type:'image'},config,panel:{hidden:false},imageMenus:{modelFor},videoMenus:null,save:()=>calls.save++,closePopover:()=>calls.close++,refreshFooter:()=>calls.footer++,position:()=>calls.position++};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function countConfiguration('),source.indexOf('  function getConfig(')),context);
 context.syncResultCountMode({detail:{mode:'variants'}});assert.equal(context.config.count,4);assert.equal(context.config.times,4);assert.equal(context.config.resultMode,'variants');
 for(const key of ['prompt','refs','quality','camera','lens'])assert.deepEqual(context.config[key],config[key]);assert.deepEqual(calls,{save:1,close:1,footer:1,position:1});
 context.syncResultCountMode({detail:{mode:'spread'}});assert.equal(context.config.count,4,'changing layout does not increase the chosen count');
 const before={...calls};context.syncResultCountMode({detail:{mode:'invalid'}});assert.deepEqual(calls,before);
 context.panel.hidden=true;context.syncResultCountMode({detail:{mode:'pile'}});assert.equal(context.resultMode,'pile');assert.deepEqual(calls,before);
 const mj=context.normalizeCountConfig({model:'midjourney-v7',count:12,prompt:'MJ'},{type:'image'});assert.equal(mj.count,3);
 const video=context.normalizeCountConfig({model:'Seedance 2.5',count:8,quality:'480p',duration:8,draft:true},{type:'video'});assert.equal(video.count,2);assert.equal(video.quality,'480p');assert.equal(video.duration,8);assert.equal(video.draft,true);
 const final=context.normalizeCountConfig({model:'Seedance 2.5',count:8,times:8,draftVideoId:'draft-source',quality:'1080p'},{type:'video'});assert.equal(final.count,1);assert.equal(final.times,1);
});

test('actual count menu presents descending result totals but commits MJ request counts',async()=>{
 const {countsFor,modelFor}=await import('../src/features/image-generation/catalog.mjs'),source=fs.readFileSync(require.resolve('../src/features/image-generation/menus.mjs'),'utf8'),items=[],chosen=[];
 const context={countsFor,modelFor,prepare(){items.length=0;},button:(label,click)=>({label,click,setAttribute(key,value){this[key]=value;}}),keyboardNavigation(){}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('export function renderCount('),source.indexOf('export function renderSpecifications(')).replace('export ',''),context);
 context.renderCount({classList:{add(){}},append:item=>items.push(item)},{model:'midjourney-v7',count:2,resultMode:'spread'},value=>chosen.push(value));
 assert.deepEqual(items.map(item=>item.label),['12×','8×','4×']);assert.equal(items[1]['aria-pressed'],true);items[1].click();assert.deepEqual(chosen,[2]);
});
