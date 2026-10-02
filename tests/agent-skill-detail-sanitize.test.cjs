const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('manager HTML sanitizer retains heading/list/table structure while removing active controls and unsafe attributes',()=>{
 const nodes=['H1','UL','LI','TABLE','TH','TD','SPAN','SCRIPT','BUTTON','SVG','A','A'].map(tagName=>({
  tagName,attrs:{class:'font-semibold',onclick:'alert(1)',style:'background:url(https://example.com)',href:tagName==='A'?'javascript:alert(1)':undefined},
  style:{},textContent:tagName==='SCRIPT'?'dangerous()':'capture text',
  classList:{contains:value=>value==='font-semibold'},
  get attributes(){return Object.keys(this.attrs).map(name=>({name}));},
  getAttribute(name){return this.attrs[name];},removeAttribute(name){delete this.attrs[name];},
  replaceWith(node){this.replacement=node;}
 }));
 nodes.at(-1).attrs.href='https://github.com/samyost1/3dicon';
 const fragment={querySelectorAll:()=>nodes},template={content:fragment};
 const context={document:{createElement:()=>template,createTextNode:text=>({textContent:text})}};
 const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');
 const sanitizer=source.match(/ function sanitize\(html\)\{[^\n]+\}/)?.[0];
 assert.ok(sanitizer,'test the existing runtime sanitizer supplied to the manager');
 vm.runInNewContext(sanitizer+';this.sanitize=sanitize',context);
 assert.equal(context.sanitize('<captured article HTML>'),fragment);
 for(const node of nodes.slice(0,7)){assert.equal(node.replacement,undefined);assert.deepEqual(node.attrs,{});}
 for(const node of nodes.slice(7,10))assert.equal(node.replacement.textContent,node.textContent);
 assert.equal(nodes.at(-2).href,undefined);
 assert.equal(nodes.at(-1).href,'https://github.com/samyost1/3dicon');
 assert.equal(nodes.at(-1).rel,'noopener noreferrer');
 assert.equal(nodes.at(-1).target,'_blank');
});
