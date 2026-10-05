const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../node-editor.js'),'utf8');
const functionSource=(name,next)=>source.slice(source.indexOf('  function '+name+'('),source.indexOf('  function '+next+'('));

async function harness(nodes,edges=[]){
 const settings=await import('../src/features/video-generation/settings.mjs');
 const references=await import('../src/features/node-composer/reference-model.mjs');
 const state={nodes,edges};
 const context={depthComposer:null,window:{EDITOR_DATA:{nodes:{}},CanvasLibrary:{items:[]}},drafts:{},cameraControls:null,videoMenus:settings,composerLayout:{referencesFor:references.referencesFor,assetReferences:()=>[]},subjects:null,app:{getState:()=>state},normalizeCountConfig:value=>({...value,resultMode:'variants'})};
 vm.createContext(context);vm.runInContext(functionSource('defaults','countConfiguration')+functionSource('getConfig','save'),context);
 return {getConfig:context.getConfig,settings,state};
}

test('reopening stored H3 normalizes generic audio and inherited empty reference mode without changing source records',async()=>{
 const saved={model:'MiniMax H3',mode:'全能参考',videoMode:'REFERENCE_TO_VIDEO',prompt:'狐狸走向镜头',quality:'768P',duration:8};
 const node={id:'h3',type:'video',generation:JSON.parse(JSON.stringify(saved))};
 const {getConfig,settings}=await harness([node]);
 const selected=getConfig(node);
 assert.equal(selected.audio,undefined);assert.equal(Object.hasOwn(selected,'audio'),false);assert.equal(selected.generateAudio,undefined);assert.equal(selected.audioLabel,'关闭');
 assert.equal(selected.mode,'首尾帧');assert.equal(selected.videoMode,'TEXT_TO_VIDEO');assert.equal(selected.quality,'768P');assert.equal(selected.duration,8);
 const prepared=settings.prepareVideoRequest({kind:'video.generate',prompt:selected.prompt,inputs:[],parameters:selected});assert.equal(prepared.parameters.providerParameters.modelType,'TEXT_TO_VIDEO');
 assert.deepEqual(node.generation,saved);
 const reopened={...node,generation:JSON.parse(JSON.stringify(selected))};const again=getConfig(reopened);
 assert.equal(Object.hasOwn(again,'audio'),false);assert.equal(again.videoMode,'TEXT_TO_VIDEO');
 assert.throws(()=>settings.prepareVideoRequest({kind:'video.generate',prompt:'API choice',inputs:[],parameters:{model:'MiniMax H3',audio:true}}),/独立音频开关/);
});

test('H3 reopen preserves reference media and frame choices while other model audio stays independent',async()=>{
 const h3={id:'h3',type:'video',generation:{model:'MiniMax H3',mode:'全能参考',quality:'2K',duration:5}};
 const first={id:'first',type:'image',image:'https://media.example/first.png'};
 const seedance={id:'seedance',type:'video',generation:{model:'Seedance 2.0',mode:'全能参考',audio:false,quality:'720p',duration:5}};
 const max={id:'max',type:'video',generation:{model:'MiniMax H3 Max',quality:'768P',duration:5}};
 const {getConfig,settings}=await harness([h3,first,seedance,max],[{id:'edge',source:'first',target:'h3'}]);
 const reference=getConfig(h3);assert.equal(reference.mode,'全能参考');assert.equal(reference.videoMode,'REFERENCE_TO_VIDEO');assert.equal(reference.audio,undefined);
 const frames=getConfig({...h3,generation:{...h3.generation,mode:'首尾帧'}});assert.equal(frames.videoMode,'IMAGE_TO_VIDEO');assert.equal(frames.ratio,undefined);
 assert.equal(settings.prepareVideoRequest({kind:'video.generate',prompt:'首帧动作',inputs:[{type:'image',id:'first',url:first.image}],parameters:frames}).parameters.providerParameters.modelType,'IMAGE_TO_VIDEO');
 const other=getConfig(seedance);assert.equal(other.audio,false);assert.equal(other.mode,'全能参考');assert.equal(other.quality,'720p');
 const maxSettings=getConfig(max);assert.equal(maxSettings.videoMode,'TEXT_TO_VIDEO');assert.equal(maxSettings.quality,'768P');assert.equal(maxSettings.audio,undefined);
});
