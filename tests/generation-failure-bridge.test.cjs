const {test}=require('node:test'),assert=require('node:assert/strict');
const moduleReady=import('../src/features/generation-results/failure-bridge.mjs');
const job=()=>({id:'run',status:'failed',providerDispatched:true,error:'供应商拒绝任务',request:{kind:'image.generate',nodeId:'source'}});
const node=()=>({id:'source',type:'image',image:'source.png',x:.125,y:-.375,generation:{prompt:'draw'}});

test('depth failure receipts require video identity for both variants and planned targets',async()=>{
 const {captureFailureReceipts}=await moduleReady,n={...node(),type:'video',video:'source.mp4'},depth={...job(),request:{kind:'video.depth',nodeId:'source'}},original={node:n,snapshot:structuredClone(n)};
 const app={getState:()=>({nodes:[n]}),getGenerationFailureTargets:()=>[n,{...n,id:'wrong',type:'image'}]};
 assert.equal(captureFailureReceipts({job:depth,app,original})[0].node,n);
 assert.deepEqual(captureFailureReceipts({job:depth,app,planned:true}).map(receipt=>receipt.node),[n]);
 n.type='image';original.snapshot.type='image';assert.deepEqual(captureFailureReceipts({job:depth,app,original}),[]);
 assert.deepEqual(captureFailureReceipts({job:depth,app,planned:true}),[]);
});
test('planned failure uses guarded result targets, never the preserved source',async()=>{
 const {captureFailureReceipts}=await moduleReady,target={...node(),id:'target',generationRun:{runId:'run'},pendingOperation:'image.generate'};
 const receipts=captureFailureReceipts({job:job(),planned:true,app:{getGenerationFailureTargets:id=>{assert.equal(id,'run');return [target];}}});
 assert.equal(receipts.length,1);assert.equal(receipts[0].node,target);assert.ok(!receipts[0].signature.includes('generationRun'));assert.ok(!receipts[0].signature.includes('pendingOperation'));
});
test('unplanned failures require original identity and content but permit movement',async()=>{
 const {captureFailureReceipts}=await moduleReady,n=node(),original={node:n,snapshot:structuredClone(n)};let nodes=[n];const app={getState:()=>({nodes})};
 const read=()=>captureFailureReceipts({job:job(),app,original});n.x=82.5;assert.equal(read()[0].node,n);n.generation.prompt='changed';assert.deepEqual(read(),[]);n.generation.prompt='draw';nodes=[structuredClone(n)];assert.deepEqual(read(),[]);nodes=[];assert.deepEqual(read(),[]);
});
test('preparation, configuration, cancelled, success and unrelated tasks cannot mount a provider failure',async()=>{
 const {captureFailureReceipts}=await moduleReady;const app={getGenerationFailureTargets(){throw Error('must not inspect targets');}};
 for(const patch of [{providerDispatched:false},{status:'configuration_required'},{status:'cancelled'},{status:'succeeded'},{error:''},{request:{kind:'image.upscale'}}])assert.deepEqual(captureFailureReceipts({job:{...job(),...patch},app,planned:true}),[]);
});
