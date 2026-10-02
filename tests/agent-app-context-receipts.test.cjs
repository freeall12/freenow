const test=require('node:test'),assert=require('node:assert/strict');

test('committed app edits reach subsequent model context and history without replaying media',async()=>{
 const {conversationContext,readConversation}=await import('../src/features/agent-history/context.mjs');
 const color={role:'tool',name:'show_app',status:'done',callId:'color',result:{kind:'mcp_app',resource_uri:'ui://tapnow/color-adjust@v2',response:{preview:{data_uri:'data:image/png;base64,PRIVATE_PIXELS'}}},colorAdjustReceipt:{node_id:'adjusted',source_node_ref:'node/source',output_sha256:'output-hash',params:{exposure:20},image:'data:image/png;base64,PRIVATE_PIXELS'},colorAdjustContext:{text:'已应用曝光 +20，结果 node/adjusted',node_id:'adjusted',output_sha256:'output-hash',params:{exposure:20},apiKey:'SECRET'}};
 const resize={role:'tool',name:'show_app',status:'done',callId:'crop',result:{kind:'mcp_app',resource_uri:'ui://tapnow/platform-resize@v1'},platformResizePlacements:[{callId:'crop-operation',count:2,node_refs:['node/square','node/portrait'],crops:[{platform:'square',x:125,y:0,w:750,h:1000}],source_sha256:'source-hash'}]};
 const chat={id:'local',messages:[color,resize]},before=structuredClone(chat);
 const memory=conversationContext(chat),read=readConversation(chat);
 assert.equal(memory.historicalEvidenceOnly,true);assert.equal(memory.mediaBodiesIncluded,false);
 for(const value of [memory,read]){
  const first=value.items[0].receipts[0].appEdits;
  assert.equal(first.colorAdjustment.node_id,'adjusted');assert.equal(first.modelContext.params.exposure,20);
  assert.equal(value.items[1].receipts[0].appEdits.platformCrops[0].count,2);
  assert.deepEqual(value.items[1].receipts[0].appEdits.platformCrops[0].node_refs,['node/square','node/portrait']);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE_PIXELS|SECRET/);
 }
 assert.deepEqual(chat,before);
 const {workspaceMetadata}=require('../server/agent-context.cjs');
 const request=JSON.parse(workspaceMetadata({conversationMemory:memory,nodes:[],edges:[]}));
 assert.equal(request.conversationMemory.items[0].receipts[0].appEdits.modelContext.node_id,'adjusted');
});

test('uncommitted, unrelated and oversized app fields do not become successful context',async()=>{
 const {conversationContext}=await import('../src/features/agent-history/context.mjs');
 const base={role:'tool',name:'show_app',status:'done',result:{kind:'mcp_app',resource_uri:'ui://tapnow/color-adjust@v2'},colorAdjustContext:{text:'not committed'}};
 for(const trace of [base,{...base,status:'error',colorAdjustReceipt:{node_id:'n'}},{...base,name:'canvas_read_node',colorAdjustReceipt:{node_id:'n'}},{...base,result:{...base.result,error:'save failed'},colorAdjustReceipt:{node_id:'n'}}]){
  const receipts=conversationContext({messages:[trace]}).items.flatMap(item=>item.receipts||[]);
  assert.ok(receipts.every(receipt=>receipt.appEdits===undefined));
 }
 const trace={...base,result:{kind:'mcp_app',resource_uri:'ui://tapnow/platform-resize@v1'},platformResizePlacements:Array.from({length:30},(_,i)=>({node_refs:['node/'+i],note:'x'.repeat(2000)}))};
 const context=conversationContext({messages:[trace]});
 assert.ok(JSON.stringify(context).length<14000);
});

test('accepted cutlist identity and assembly receipts remain discoverable in later turns',async()=>{
 const {conversationContext,readConversation}=await import('../src/features/agent-history/context.mjs');
 const handoff='cutlist_'+'a'.repeat(64),trace={id:'actual-app-trace',role:'tool',name:'show_app',status:'done',result:{kind:'mcp_app',resource_uri:'ui://tapnow/cutlist-review@v1'},appHandoffs:Array.from({length:17},(_,i)=>i===16?handoff:'earlier-'+i),cutlistAssemblyReceipts:[{operationId:'assemble-one',saved:true,nodeIds:['assembled-video'],mediaSha256:'real-hash'}]};
 const chat={id:'chat',messages:[trace,...Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',text:'later'}))]};
 const receipt=conversationContext(chat).items[0].receipts[0];
 assert.equal(receipt.traceId,'actual-app-trace');assert.equal(receipt.appEdits.acceptedHandoffs.at(-1),handoff);
 assert.equal(receipt.appEdits.omittedEarlierHandoffs,1);assert.equal(receipt.appEdits.assemblies[0].operationId,'assemble-one');
 const read=readConversation(chat,{before_index:1});assert.equal(read.items[0].receipts[0].traceId,receipt.traceId);
 assert.equal(read.historicalEvidenceOnly,true);
});
