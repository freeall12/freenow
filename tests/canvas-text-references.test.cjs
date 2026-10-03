const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../canvas-text.js'), clipboard = require('../canvas-clipboard.js');
const fixture = () => {
  const n = {id:'g',type:'text',textMode:'generate',generation:{prompt:'比较 {{Text 1}} 与 {{Text 2}}，再看 {{Image 1}}',referenceIds:['a','b','i']}};
  const nodes=[n,{id:'a',type:'text',title:'A',content:'甲'},{id:'b',type:'text',title:'B',content:'乙'},{id:'i',type:'image',image:'image.png'}],edges=nodes.slice(1).map(source=>({id:source.id+'g',source:source.id,target:'g'}));
  n.generation=core.reconcile(core.config(n),core.references(n,nodes,edges));return {n,nodes,edges};
};
test('same-type reorder changes ordinals without changing source meaning or mutating graph',()=>{
  const {n,nodes,edges}=fixture(),before=JSON.stringify(nodes),changed=core.transition(n,{referenceIds:['b','a','i']}),next=core.reconcile(changed,core.references({...n,generation:changed},nodes,edges));
  assert.equal(next.prompt,'比较 {{Text 2}} 与 {{Text 1}}，再看 {{Image 1}}');
  assert.deepEqual(next.promptReferenceBindings.map(binding=>binding.referenceKey),['node:b','node:a','node:i']);
  const request=core.request({...n,generation:next},nodes,edges);assert.equal(request.prompt,'比较 甲 与 乙，再看 {{Image 1}}');assert.equal(JSON.stringify(nodes),before);
});
test('edge/source cleanup removes all bound occurrences and renumbers survivors in one config',()=>{
  const {n,nodes,edges}=fixture();n.generation.prompt+=' {{Text 1}}';
  const next=core.withoutSources(n,[nodes[1]],nodes,edges);
  assert.deepEqual(next.referenceIds,['b','i']);assert.equal(next.prompt,'比较  与 {{Text 1}}，再看 {{Image 1}} ');
  assert.deepEqual(next.promptReferenceBindings.map(binding=>binding.referenceKey),['node:b','node:i']);
  assert.equal(core.request({...n,generation:next},nodes,edges.filter(edge=>edge.source!=='a')).prompt,'比较  与 乙，再看 {{Image 1}} ');
});
test('historical missing/self/unsupported IDs never block source deletion and legacy tokens bind before removal',()=>{
  const {n,nodes,edges}=fixture();n.generation.promptReferenceBindings=[];n.generation.referenceIds=['missing','g','audio','a','b'];nodes.push({id:'audio',type:'audio'});edges.push({id:'bad',source:'missing',target:'g'});
  const next=core.withoutSources(n,[nodes[1]],nodes,edges);
  assert.deepEqual(next.referenceIds,['b']);assert.equal(next.prompt,'比较  与 {{Text 1}}，再看 {{Image 1}}');
  assert.deepEqual(next.promptReferenceBindings.map(binding=>binding.referenceKey),['node:b','node:i']);
});
test('source title/content/media changes retain keys and use the newest text exactly once',()=>{
  const {n,nodes,edges}=fixture(),key=core.references(n,nodes,edges)[0].key;
  nodes[1].title='重命名';nodes[1].content='最新甲';nodes[3].fullImage='replacement.png';
  const refs=core.references(n,nodes,edges);assert.equal(refs[0].key,key);assert.equal(refs[0].title,'重命名');assert.equal(refs[2].url,'replacement.png');
  const request=core.request(n,nodes,edges);assert.equal(request.prompt,'比较 最新甲 与 乙，再看 {{Image 1}}');assert.equal(request.prompt.split('最新甲').length,2);
  n.generation.prompt='只引用 {{Text 2}}';assert.equal(core.request(n,nodes,edges).prompt,'最新甲\n\n只引用 乙');
});
test('empty sources stay removable but never become ambiguous atomic mention candidates',()=>{
  const {n,nodes,edges}=fixture();nodes[1].content='  ';
  const refs=core.references(n,nodes,edges);assert.equal(refs[0].empty,true);assert.deepEqual(core.mentionItems(refs).map(item=>item.renderText),['Text 1','Image 1']);
  assert.throws(()=>core.request(n,nodes,edges),/没有内容/);
  assert.equal(core.reconcile(n.generation,refs).prompt,'比较  与 {{Text 1}}，再看 {{Image 1}}');
});
test('duplicate remaps copied source IDs and keys while keeping external references and prompt ordinals',()=>{
  const {n}=fixture(),before=JSON.stringify(n),mapping=new Map([['g','copy-g'],['a','copy-a']]),next=core.remapGeneration(n,mapping);
  assert.deepEqual(next.referenceIds,['copy-a','b','i']);assert.deepEqual(next.promptReferenceBindings.map(binding=>binding.referenceKey),['node:copy-a','node:b','node:i']);assert.equal(next.prompt,n.generation.prompt);assert.equal(JSON.stringify(n),before);
});
test('clipboard text graph copies map semantic bindings to internal sources and retain external edges',()=>{
  const {n,nodes,edges}=fixture();nodes.forEach((node,index)=>Object.assign(node,{x:100+index*400,y:50,width:300,height:200}));
  const snapshot=clipboard.capture(nodes,edges,['g','a']);let count=0;const graph=clipboard.instantiate(snapshot,nodes,{x:0,y:0},0,1,()=>`copy-${++count}`),copy=graph.nodes.find(node=>node.type==='text'&&node.textMode==='generate'),source=graph.nodes.find(node=>node.id!==copy.id);
  assert.deepEqual(copy.generation.referenceIds,[source.id,'b','i']);assert.deepEqual(copy.generation.promptReferenceBindings.map(binding=>binding.referenceKey),['node:'+source.id,'node:b','node:i']);assert.equal(copy.generation.prompt,n.generation.prompt);assert.equal(graph.edges.find(edge=>edge.source===source.id).target,copy.id);
});
test('config rejects malformed identities and bindings before any host update',()=>{
  const {n}=fixture();assert.throws(()=>core.transition(n,{referenceIds:[{}]}),/身份/);assert.throws(()=>core.transition(n,{promptReferenceBindings:[{referenceKey:'node:a',renderText:'Text 0'}]}),/绑定/);
});
