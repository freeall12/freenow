'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(node){
 const source=fs.readFileSync(require.resolve('../canvas-menus.js'),'utf8'),start=source.indexOf('  const primaryMedia ='),end=source.indexOf('  // Geometry reads',start),calls=[];let items;
 const app={getState:()=>({nodes:[node],selected:[node.id]}),saveSelection:()=>calls.push('save'),duplicate:()=>calls.push('duplicate'),remove:ids=>calls.push(['remove',...ids])};
 const window={EDITOR_DATA:{nodes:{legacy:{video:'asset:legacy.mp4'}}},CanvasGroups:{descendants:()=>new Set([node.id])},FeedbackAPI:{open:ids=>calls.push(['feedback',...ids])}};
 const context={app,window,copied:null,variants:()=>[],applyHistory:n=>calls.push(['history',n.id]),keepMain(){},download:n=>calls.push(['download',n.id]),copy:()=>calls.push('copy'),paste(){},copyImage:n=>calls.push(['clipboard',n.id]),show:(x,y,value)=>items=value};
 vm.runInNewContext(source.slice(start,end)+'\nthis.nodeMenu=node;',context);context.nodeMenu(20,30);
 return {items:items.filter(Boolean),calls};
}
test('image with an original fullImage keeps history, download and native image copy reachable',()=>{
 const f=fixture({id:'original',type:'image',fullImage:'asset:original.png'}),labels=f.items.map(item=>item.label);
 for(const label of ['保存到素材库','应用所有历史','下载','复制到剪贴板'])assert(labels.includes(label));
 for(const label of ['应用所有历史','下载','复制到剪贴板'])f.items.find(item=>item.label===label).run();
 assert.deepEqual(f.calls,[['history','original'],['download','original'],['clipboard','original']]);
});
test('legacy editor-backed video has the same history and download entrypoints as its primary source',()=>{
 const f=fixture({id:'legacy',type:'video'});for(const label of ['保存到素材库','应用所有历史','下载'])assert(f.items.some(item=>item.label===label&&typeof item.run==='function'));assert(!f.items.some(item=>item.label==='复制到剪贴板'));
});
test('empty media nodes omit media commands and cannot save empty assets',()=>{
 for(const type of ['image','video','audio']){const f=fixture({id:'empty',type});assert.equal(f.items[0].label,'保存到素材库');assert.equal(f.items[0].run,null);for(const label of ['应用所有历史','下载','复制到剪贴板'])assert(!f.items.some(item=>item.label===label));}
});
test('unsupported studio copy/paste stay disabled while delete and feedback remain real actions',()=>{
 const f=fixture({id:'studio',type:'studio'});for(const label of ['复制','粘贴','副本'])assert.equal(f.items.find(item=>item.label===label).run,null);
 f.items.find(item=>item.label==='删除').run();f.items.find(item=>item.label==='反馈问题').run();assert.deepEqual(f.calls,[['remove','studio'],['feedback','studio']]);
});
