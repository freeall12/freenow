const test=require('node:test'),assert=require('node:assert/strict');
const {parse,delegationTools}=require('../agent-tools.js');
const state={nodeId:'editor',sessionId:'session',expectedRevision:4};
test('editor tools require current session and action-specific bounded input without arbitrary objects or URLs',()=>{
 assert.equal(parse('image_editor_edit',{...state,action:'update',objectId:'layer',properties:{left:1.125,top:-5.75,opacity:.4,flipX:true}}).args.properties.left,1.125);
 for(const args of [{...state,action:'remove',objectId:'layer',points:[{x:0,y:0},{x:1,y:1}]},{...state,action:'add',kind:'image',properties:{src:'https://example.test/a.png'}},{...state,action:'add',kind:'line',points:[{x:0,y:0},{x:1,y:1},{x:2,y:2}]},{...state,expectedRevision:4.5,action:'undo'},{nodeId:'editor',action:'undo'}])assert.throws(()=>parse('image_editor_edit',args));
 assert.throws(()=>parse('image_editor_read',{nodeId:'editor',objectId:'layer',offset:2}));
 assert.throws(()=>parse('image_editor_read',{nodeId:'editor',textOffset:2}));
 assert.equal(delegationTools.some(name=>name.startsWith('image_editor_')),false);
});
test('editor presentation keeps edited draft distinct from durable save and changed current state',async()=>{
 const {toolPresentation}=await import('../src/features/agent-execution/presentation.mjs');
 const pending=toolPresentation({name:'image_editor_create',status:'pending',args:{x:1.125,y:-4.75,width:600,height:800}});assert.match(pending.detail,/1\.125, -4\.75/);assert.match(pending.label,/等待确认/);
 const unsaved=toolPresentation({name:'image_editor_save',status:'error',result:{applied:true,saved:false,error:'quota'}});assert.match(unsaved.label,/已更新画布，保存未完成/);
 const changed=toolPresentation({name:'image_editor_save',status:'done',result:{applied:true,saved:true,currentMatches:false}});assert.match(changed.label,/当前文档已变化/);assert.doesNotMatch(changed.label,/已保存到画布/);
});

test('crop/erase contracts keep source pixels distinct from explicit artboard stroke targets',()=>{
 const cropped=parse('image_editor_edit',{...state,action:'crop',objectId:'photo',crop:{x:10.25,y:20.5,width:200.5,height:100.25}});assert.equal(cropped.args.crop.x,10.25);
 parse('image_editor_edit',{...state,action:'erase',objectIds:['a','b'],points:[{x:1.25,y:3.5},{x:10.5,y:20.25}],strokeWidth:5});
 for(const args of [{...state,action:'crop',objectId:'photo',crop:{x:-1,y:0,width:20,height:20}},{...state,action:'erase',points:[{x:0,y:0},{x:1,y:1}],strokeWidth:3},{...state,action:'erase',objectIds:['a','a'],points:[{x:0,y:0},{x:1,y:1}],strokeWidth:3},{...state,action:'erase',objectIds:['a'],points:[{x:0,y:0},{x:1,y:1}],strokeWidth:3,properties:{fill:'#fff'}}])assert.throws(()=>parse('image_editor_edit',args));
 assert.equal(parse('image_editor_export',{...state,operationId:'export-1',format:'psd',scale:2}).definition.mutates,true);
 assert.throws(()=>parse('image_editor_export',{...state,operationId:'export-1',format:'svg',scale:1}));
});

test('pose contract exposes only official joints/colors and distinguishes create from patch',async()=>{
 assert.equal(parse('image_editor_edit',{...state,action:'pose',pose:{color:'blue',joints:{leftHand:[210.125,88.5]}}}).args.pose.joints.leftHand[0],210.125);
 parse('image_editor_edit',{...state,action:'pose',pose:{}});
 for(const pose of [{color:'purple'},{joints:{unknown:[1,2]}},{joints:{head:[1,2,3]}},{joints:{head:[6001,0]}},{joints:{}},{src:'https://example.test/a.png'}])assert.throws(()=>parse('image_editor_edit',{...state,action:'pose',pose}));
 assert.throws(()=>parse('image_editor_edit',{...state,action:'pose',objectId:'existing',pose:{}}));
 assert.throws(()=>parse('image_editor_edit',{...state,action:'pose',pose:{color:'red'},properties:{left:10}}));
 const {toolPresentation}=await import('../src/features/agent-execution/presentation.mjs');
 const view=toolPresentation({name:'image_editor_edit',status:'pending',args:{...state,action:'pose',pose:{color:'blue',joints:{leftHand:[1,2]}}}});
 assert.match(view.label,/本地姿势.*等待确认/);assert.match(view.detail,/姿势源像素关节点：leftHand/);assert.doesNotMatch(view.label,/生成完成/);
});
