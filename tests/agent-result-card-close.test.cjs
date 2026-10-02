const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');
const renderer=source.slice(source.indexOf(' function appendResultCards('),source.indexOf(' function taskSummary('));
function card(close){
 const calls=[],handlers=[],node={id:'output',title:'生成结果',image:'image.png'},element=()=>({append(){}});
 const app={getState:()=>({nodes:[node]}),select:(...args)=>calls.push(['select',...args]),preview:value=>calls.push(['preview',value.id])};
 const scope={app,window:{StudioAPI:{active:{close}},UI_ICONS:{}},el:element,btn:(icon,label,handler)=>{handlers.push(handler);return element();},notice:text=>calls.push(['notice',text])};
 vm.runInNewContext(renderer,scope);scope.appendResultCards(element(),{nodeId:node.id});return {click:handlers[0],calls};
}
test('result card waits for studio close and persistence before focusing or previewing the output',async()=>{
 let finish;const host=card(()=>new Promise(done=>{finish=done;})),clicked=host.click();
 assert.deepEqual(host.calls,[]);finish();await clicked;
 assert.deepEqual(host.calls,[['select','output',true],['preview','output']]);
});
test('failed asynchronous or synchronous studio close preserves the workspace and is handled visibly',async()=>{
 for(const close of [async()=>{throw Error('片场保存失败');},()=>{throw Error('片场仍在编辑');}]){
  const host=card(close);await assert.doesNotReject(host.click());assert.equal(host.calls.length,1);assert.equal(host.calls[0][0],'notice');assert.match(host.calls[0][1],/片场/);
 }
});
