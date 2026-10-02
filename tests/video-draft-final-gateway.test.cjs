const test=require('node:test'),assert=require('node:assert/strict');
const {createGenerationGateway}=require('../server/generation.cjs');
const send=async(gateway,path,method='GET',input)=>{let response;await gateway.handle({method},{},path,{json:(_,status,value)=>{response={status,value};},body:async()=>input});return response;};
async function terminal(gateway,id){for(let i=0;i<100;i++){const r=await send(gateway,'/api/generation/tasks/'+id);if(['succeeded','failed','configuration_required'].includes(r.value.status))return r.value;await new Promise(r=>setTimeout(r,5));}throw Error('task did not terminate');}
test('HTTP gateway submits final identity only and never downgrades invalid final claims',async()=>{
 const requests=[];const gateway=createGenerationGateway({baseUrl:'https://provider.test',apiKey:'test-only',fetchImpl:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({outputs:[{type:'video',url:'https://provider.test/final.mp4'}]})};}});
 const created=await send(gateway,'/api/generation/tasks','POST',{kind:'video.generate',prompt:'must not forward',inputs:[{type:'image',url:'/unused.png'}],parameters:{model:'Seedance 2.5',draftVideoId:'file-draft',quality:'480p',refs:['unused'],element_refs:['unused']}});
 assert.equal((await terminal(gateway,created.value.id)).status,'succeeded');
 assert.deepEqual(requests[0].parameters.providerParameters,{model:'seedance-2.5',draft_video_id:'file-draft',resolution:'1080p',times:1});
 assert.equal(requests[0].prompt,'');assert.deepEqual(requests[0].inputs,[]);assert.equal(requests[0].parameters.element_refs,undefined);assert.equal(requests[0].parameters.refs,undefined);
 for(const parameters of [{model:'Seedance 2.5',draftVideoId:''},{model:'Seedance 2.5',draftVideoId:null},{model:'Seedance 2.5',draftVideoId:0},{model:'other',draftVideoId:'file'},{model:'Seedance 2.5',providerParameters:{draft_video_id:'file'}}]){
  const result=await send(gateway,'/api/generation/tasks','POST',{kind:'video.generate',prompt:'not fallback',parameters});assert.equal((await terminal(gateway,result.value.id)).status,'failed');
 }
 assert.equal(requests.length,1);
});
test('HTTP gateway preserves 480p draft contract and honest missing provider state',async()=>{
 let request;const gateway=createGenerationGateway({baseUrl:'https://provider.test',apiKey:'test-only',fetchImpl:async(url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({outputs:[{type:'video',url:'https://provider.test/draft.mp4',sourceFileId:'draft-file'}]})};}});
 const created=await send(gateway,'/api/generation/tasks','POST',{kind:'video.generate',prompt:'测试',parameters:{model:'Seedance 2.5 样片',quality:'1080p',videoMode:'TEXT_TO_VIDEO'}});
 assert.equal((await terminal(gateway,created.value.id)).status,'succeeded');assert.equal(request.parameters.providerParameters.draft,true);assert.equal(request.parameters.providerParameters.resolution,'480p');assert.equal(request.prompt,'测试');
 const unconfigured=createGenerationGateway(),job=await send(unconfigured,'/api/generation/tasks','POST',{kind:'video.generate',parameters:{model:'Seedance 2.5',draftVideoId:'draft-file'}});
 assert.equal((await terminal(unconfigured,job.value.id)).status,'configuration_required');
});
