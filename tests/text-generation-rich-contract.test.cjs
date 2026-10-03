const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./text-generation-render.test.cjs');
const source=fs.readFileSync(require.resolve('../text-generation-ui.js'),'utf8').replace("import('./assets/agent-editor.js')","Promise.resolve({createNodePrompt:window.createTestPrompt})").replace("import('./src/features/canvas-reference-picker/entry.mjs')","Promise.resolve({pickReference:window.createTestPicker})");
async function richFixture(){
 let f,options,control,pickerOptions;const voices=[],calls={created:0,destroyed:0,synced:0,connections:[],removed:[]};
 const createTestPrompt=config=>{options=config;calls.created++;const dom=f.document.createElement('div');dom.className='prompt-editor';config.element.append(dom);let value=config.value;
  control={dom,getText:()=>value,sync(text){calls.synced++;value=text;},insert(item){const refs=f.window.CanvasText.mentionItems(config.getItems()),ref=refs.find(candidate=>candidate.key===item.key);value+=' {{'+ref.renderText+'}}';config.onChange(value);},captureSelection(){return {from:1,to:1,initialValue:value};},commitTranscript(snapshot,text){if(snapshot.initialValue!==value)return false;value+=text;config.onChange(value);return true;},close(){},destroy(){calls.destroyed++;}};return control;
 };
 f=fixture({script:source,windowPatch:{createTestPrompt,createTestPicker(config){pickerOptions=config;return {close(){config.onClose();}};},VoiceInput:{bind(trigger,config){voices.push({trigger,config});}}},appPatch:{connect(source,target){calls.connections.push([source,target]);},removeEdges(ids){calls.removed.push(ids);}}});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 return {...f,calls,voices,get options(){return options;},get control(){return control;},get pickerOptions(){return pickerOptions;}};
}
test('production text UI keeps its rich control and selection contract across typing, source updates, models and movement',async()=>{
 const f=await richFixture(),control=f.control,dom=control.dom;assert.equal(f.calls.created,1);
 control.insert(f.options.getItems()[0]);assert.match(f.target.generation.prompt,/\{\{Text 1\}\}/);assert.equal(f.target.generation.promptReferenceBindings[0].referenceKey,'node:ref-0');
 f.state.nodes[1].title='重命名';f.state.nodes[1].content='替换正文';f.render();assert.equal(f.control,control);assert.equal(f.options.getItems()[0].title,'重命名');assert.equal(f.options.getItems()[0].text,'替换正文');
 f.window.TextAPI.setConfig('target',{model:'gpt-6-astra'});assert.equal(f.control.dom,dom);assert.equal(f.calls.created,1);assert.equal(f.calls.destroyed,0);
 const created=f.calls.created,synced=f.calls.synced;f.render({viewportOnly:true});assert.equal(f.calls.created,created);assert.equal(f.calls.synced,synced);
 f.state.selected=[];f.render();assert.equal(f.calls.destroyed,1);assert.equal(f.window.TextAPI.promptEditor,null);
});
test('production voice binding delegates capture and commit to the retained prompt control and refuses stale snapshots',async()=>{
 const f=await richFixture(),binding=f.voices.at(-1).config,control=f.control;assert.equal(binding.target,control.dom);assert.equal(binding.captureSelection,control.captureSelection);assert.equal(binding.commitTranscript,control.commitTranscript);
 const snapshot=binding.captureSelection();assert.equal(binding.commitTranscript(snapshot,'语音文字'),true);assert.match(f.target.generation.prompt,/语音文字/);
 const stale=binding.captureSelection();f.window.TextAPI.setConfig('target',{prompt:'新的编辑'});assert.equal(binding.commitTranscript(stale,'迟到'),false);assert.equal(f.target.generation.prompt,'新的编辑');assert.equal(binding.isCurrent(),true);
 f.state.selected=[];f.render();assert.equal(binding.isCurrent(),false);
});
test('production plus uses the mature canvas picker; removing a connected chip submits only the edge transaction',async()=>{
 const f=await richFixture();await f.window.TextAPI.selectReference('target');assert.equal(f.pickerOptions.targetId,'target');assert.deepEqual(Array.from(f.pickerOptions.allowedTypes),['image','video','text']);
 f.pickerOptions.onSelect('ref-1');assert.deepEqual(f.calls.connections,[['ref-1','target']]);assert.equal(f.target.generation.referenceIds,undefined);
 f.panel.querySelector('.text-reference-chip').children[1].onclick();assert.deepEqual(f.calls.removed,[['edge-0']]);assert.equal(f.target.generation.referenceIds,undefined);
});
