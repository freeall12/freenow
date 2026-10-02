const test=require('node:test'),assert=require('node:assert/strict');
test('saved local video bytes reach provider inputs with IDs/metadata and ordered text references',async()=>{
 const {prepareAgentMediaInputs}=await import('../src/features/agent-generation/media-inputs.mjs');
 const {prepareWorkflowInputs}=await import('../src/features/agent-workflows/media-transport.mjs');
 const blob=new Blob(['actual local bytes'],{type:'video/mp4'}),url=URL.createObjectURL(blob);
 const refs=[{id:'saved-whitebox',type:'video',video:'asset:whitebox'},{id:'instructions',type:'text',content:'保留空间关系'}];
 try{
  const result=await prepareAgentMediaInputs(refs,{getNode:id=>refs.find(node=>node.id===id),baseUrl:'http://localhost:4173/',
   resolveMedia:async node=>({id:node.id,type:node.type,url,width:320,height:180,duration:4}),
   transport:(request,options)=>prepareWorkflowInputs(request,{...options,serialize:async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64')})});
  assert.equal(result.inputs[0].id,'saved-whitebox');assert.equal(result.inputs[0].duration,4);
  assert.equal(Buffer.from(result.inputs[0].url.split(',')[1],'base64').toString(),'actual local bytes');
  assert.equal(result.inputs[1].text,'保留空间关系');
  refs[0]={...refs[0]};assert.throws(result.guard,/替换/);
 }finally{URL.revokeObjectURL(url);}
});
test('source edits during media preparation never return dispatchable inputs',async()=>{
 const {prepareAgentMediaInputs}=await import('../src/features/agent-generation/media-inputs.mjs');
 const node={id:'clip',type:'video',video:'asset:source',clip:{start:1,end:3}};
 await assert.rejects(prepareAgentMediaInputs([node],{getNode:()=>node,resolveMedia:async()=>{node.clip.end=4;return {id:node.id,type:'video',url:'data:video/mp4;base64,AAAA'};},transport:async()=>{throw Error('must not transport changed reference');}}),/修改/);
});
