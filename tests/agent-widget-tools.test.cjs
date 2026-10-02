const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../agent-tools.js'),{AgentRuntime}=require('../server/agent.cjs');
const modulePromise=import('../src/features/agent-widgets/tools.mjs');
const htmlFile={artifact_path:'artifacts/作品.html',content_type:'html',content:'<!doctype html><html><body>内容</body></html>',title:'文件标题',revision:12};

test('display schemas are nonmutating and reject extra authority, invalid paths and oversized code',()=>{
 assert.equal(parse('show_widget',{widget_code:'<button>继续</button>'}).definition.mutates,false);
 assert.equal(parse('show_html',{artifact_path:htmlFile.artifact_path}).definition.mutates,false);
 for(const invalid of [{widget_code:''},{widget_code:'   '},{widget_code:'x'.repeat(60001)},{widget_code:'<p>x</p>',canvasApi:true},{widget_code:'x',title:1}])assert.throws(()=>parse('show_widget',invalid));
 for(const artifact_path of ['../private','https://example.com/a.html','artifacts/../x','artifacts//x','artifacts/x?secret','artifacts/x\\y'])assert.throws(()=>parse('show_html',{artifact_path}));
 for(const extra of [{revision:12},{namespace:'other'},{html:'forged'},{url:'https://example.com'},{description:'x'.repeat(4001)}])assert.throws(()=>parse('show_html',{artifact_path:htmlFile.artifact_path,...extra}));
});

test('widget preparation treats scripts as data and returns metadata without claiming rendering or persistence',async()=>{
 const {prepareWidget}=await modulePromise;
 const args={title:'交互页面',widget_code:'<script>throw new Error("never execute");</script>'};
 assert.deepEqual(prepareWidget(args),{kind:'widget',title:'交互页面'});assert.deepEqual(prepareWidget({widget_code:'<div>你好</div>'}),{kind:'widget',title:'互动组件'});
 assert.equal(args.widget_code,'<script>throw new Error("never execute");</script>');assert.ok(!JSON.stringify(prepareWidget(args)).includes('never execute'));
 for(const value of [null,[],{}, {widget_code:' '},{widget_code:'x'.repeat(60001)},{widget_code:'x',execute:true}])assert.throws(()=>prepareWidget(value));
});

test('HTML preparation reads full local content once and binds actual namespace/path/revision without copying code',async()=>{
 const {prepareHtml}=await modulePromise;let gets=0;
 const file={...htmlFile,content:'<html>'+('中文'.repeat(12000))+'</html>'},store={namespace:'canvas-a',async get(path){gets++;assert.equal(path,file.artifact_path);return file;},read(){assert.fail('paged read cannot prove complete HTML');},write(){assert.fail('display does not write an artifact');}};
 const prepared=await prepareHtml({artifact_path:file.artifact_path},{store,namespace:'canvas-a'});
 assert.deepEqual(prepared,{kind:'html',namespace:'canvas-a',artifact_path:file.artifact_path,revision:12,title:'HTML'});assert.equal(gets,1);assert.equal(prepared.content,undefined);assert.equal(prepared.rendered,undefined);
 assert.deepEqual(await prepareHtml({artifact_path:file.artifact_path,title:'展示标题',description:'介绍'},{store}),{...prepared,title:'展示标题',description:'介绍'});
 file.revision=13;const next=await prepareHtml({artifact_path:file.artifact_path},{store});assert.equal(prepared.revision,12);assert.equal(next.revision,13,'viewer can compare captured revision and reject stale cards');
});

test('HTML preparation rejects missing, wrong-kind, mismatched namespace/path and incomplete metadata',async()=>{
 const {prepareHtml}=await modulePromise,args={artifact_path:htmlFile.artifact_path};let reads=0;
 const store={namespace:'canvas-a',get:async()=>{reads++;return htmlFile;}};
 await assert.rejects(()=>prepareHtml(args,{store,namespace:'canvas-b'}),/存储/);assert.equal(reads,0);
 await assert.rejects(()=>prepareHtml(args,{store:{get:store.get}}),/存储/);
 await assert.rejects(()=>prepareHtml({...args,revision:12},{store}),/参数/);
 await assert.rejects(()=>prepareHtml({...args,description:5},{store}),/描述/);
 for(const file of [null,{...htmlFile,artifact_path:'artifacts/other.html'},{...htmlFile,content_type:'markdown'},{...htmlFile,content:''},{...htmlFile,content:'x'.repeat(60001)},{...htmlFile,content:undefined},{...htmlFile,revision:0},{...htmlFile,revision:1.5},{...htmlFile,revision:undefined}])await assert.rejects(()=>prepareHtml(args,{store:{namespace:'canvas-a',get:async()=>file}}));
 await assert.rejects(()=>prepareHtml(args,{store:{namespace:'canvas-a',get:async()=>{throw Error('产物不存在');}}}),/产物不存在/);
});

test('Responses exposes display definitions and continues from metadata receipts without a user-answer barrier',async()=>{
 const requests=[],output=[{type:'function_call',name:'show_widget',arguments:JSON.stringify({widget_code:'<div>可交互</div>'}),call_id:'widget'},{type:'function_call',name:'show_html',arguments:JSON.stringify({artifact_path:htmlFile.artifact_path}),call_id:'html'}];
 const agent=new AgentRuntime({model:'test-model',client:{responses:{create:async request=>{requests.push(request);return {output:requests.length===1?output:[{type:'message',content:[{type:'output_text',text:'展示记录已准备'}]}]};}}}});
 const first=await agent.start({message:'展示互动页面'});assert.deepEqual(first.calls.map(call=>call.name),['show_widget','show_html']);assert.ok(first.calls.every(call=>call.mutates===false));
 const {prepareWidget,prepareHtml}=await modulePromise,widget=prepareWidget(first.calls[0].args),html=await prepareHtml(first.calls[1].args,{store:{namespace:'canvas-a',get:async()=>htmlFile}});
 const done=await agent.resume(first.sessionId,[{callId:'widget',result:widget},{callId:'html',result:html}]);assert.equal(done.done,true);
 for(const name of ['show_widget','show_html'])assert.ok(requests[0].tools.some(tool=>tool.name===name));
 assert.match(requests[0].instructions,/Widget messages become ordinary new user turns/);
 const receipts=requests[1].input.filter(item=>item.type==='function_call_output');assert.deepEqual(receipts.map(item=>JSON.parse(item.output)),[widget,html]);
});
