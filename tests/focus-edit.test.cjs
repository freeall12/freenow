const test=require('node:test'),assert=require('node:assert/strict');
test('prompt serialization preserves native Enter, blank lines, trailing newlines and focus tokens',async()=>{
 const {readPrompt}=await import('../src/features/focus-edit/prompt.mjs');
 const text=value=>({nodeType:3,nodeName:'#text',textContent:value});
 const element=(name,...children)=>({nodeType:1,nodeName:name,childNodes:children});
 const token={nodeType:1,nodeName:'SPAN',dataset:{focusToken:'{{magic_item:example}}'}};
 assert.equal(readPrompt(element('DIV',text('第一行'),element('DIV',text('第二行')))),'第一行\n第二行');
 assert.equal(readPrompt(element('DIV',text('第一行'),element('DIV',element('BR')),element('DIV',token))), '第一行\n\n{{magic_item:example}}');
 assert.equal(readPrompt(element('DIV',text('第一行'),element('DIV',element('BR')))), '第一行\n');
 assert.equal(readPrompt(element('DIV',text('第一行\n'))), '第一行\n');
 assert.equal(readPrompt(element('DIV',element('P',text('第一段')),element('P',text('第二段')))), '第一段\n第二段');
});
test('focus recognition rejects inverted and non-normalized boxes but keeps valid candidates',async()=>{
 const {detections,point}=await import('../src/features/focus-edit/model.mjs');
 const valid={label_name:'人物',box_2d:[.1,.2,.9,.8]};
 assert.deepEqual(detections({items:[null,{label_name:'错误',box_2d:[0,0,100,100]},valid]}),[valid]);
 assert.throws(()=>detections({items:[{label_name:'逆序',box_2d:[.8,.9,.1,.2]}]}),/未识别/);
 assert.deepEqual(point({left:10.25,top:20.5,width:100.5,height:50.25},60.5,45.625),{x:.5,y:.5});
});
test('focus references replace only the intended mark and preserve arbitrary surrounding text',async()=>{
 const {token,splitPrompt,replaceMark}=await import('../src/features/focus-edit/model.mjs');
 const a={_markId:'a',label_name:'物体 } <script>',nodeId:'image'},b={_markId:'b',label_name:'其他'};
 const value='保留\n'+token(a)+' 和 '+token(b)+'，继续';
 assert.equal(splitPrompt(value).filter(p=>typeof p!=='string').length,2);
 assert.equal(replaceMark(value,'a',null),'保留\n 和 '+token(b)+'，继续');
 const updated=replaceMark(value,'a',{...a,label_name:'背景'});
 assert.ok(updated.includes(token(b)));assert.ok(updated.includes('背景'));
 assert.deepEqual(splitPrompt('{{magic_item:{broken}}}'),['{{magic_item:{broken}}}']);
});
