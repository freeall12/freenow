'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element{
 constructor(tag,cls='',text){this.tagName=tag;this.className=cls;this.textContent=text??'';this.children=[];this.attributes={};this.dataset={};this.classList={toggle(){}};}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}setAttribute(key,value){this.attributes[key]=String(value);}
 querySelector(selector){return this.children.find(child=>selector==='.'+child.className)||null;}
}
test('production depth footer reaches voice/count/generate using actual depth settings and no video model config',async()=>{
 const composer=await import('../composer.mjs'),videoMenus=await import('../../video-generation/settings.mjs'),source=fs.readFileSync(require.resolve('../../../../node-editor.js'),'utf8'),start=source.indexOf('  function refreshFooter('),end=source.indexOf('  function imageInputCount(',start),code=source.slice(start,end);
 function harness(footerCode){
  const footer=new Element('div','generation-footer'),prompt=new Element('div','prompt-editor'),context={node:{id:'target',type:'video'},config:composer.depthComposerSettings({count:2}),depthComposer:composer,depthSelected:composer.isDepthModel,depthIcon:()=>new Element('img','image-model-icon'),modelLabel:value=>value,draftFinalUI:null,panel:{querySelector:selector=>selector==='.generation-footer'?footer:prompt},pop:{hidden:true},popAnchor:null,videoMenus:{...videoMenus,modelIcon:()=>null},videoInputs:()=>[{id:'source',type:'video',url:'data:video/mp4;base64,AAAA'}],make:(...args)=>new Element(...args),button:(label,fn,cls)=>Object.assign(new Element('button',cls,label),{onclick:fn}),icon:()=>'<svg/>',imageMenus:null,modelMenu(){},qualityMenu(){},countMenu(){},submitGeneration(){},promptControl:null,focusEdit:null,activeId:'target',updateBusyState(){},placePopover(){},window:{VoiceInput:{bind:()=>assert.fail('read-only depth must not bind voice')}}};
  vm.createContext(context);vm.runInContext(footerCode,context);return {context,footer};
 }
 // This is the browser failure's actual production function and real model
 // settings; the unsafe optional-chain variant proves the reproduction.
 const before=harness(code.replace('videoData?.options?.supportsAudio','videoData?.options.supportsAudio'));assert.throws(()=>before.context.refreshFooter(),/supportsAudio/);
 const after=harness(code);after.context.refreshFooter();
 assert.equal(after.footer.querySelector('.model-trigger').children.at(-1).textContent,'Depth Anything Video');assert.equal(after.footer.querySelector('.quality-trigger').children.at(-1).textContent,'视频编辑 · 自动');
 assert.equal(after.footer.querySelector('.voice-trigger').disabled,true);assert.equal(after.footer.querySelector('.count-trigger').textContent,'2×');assert.ok(after.footer.querySelector('.generate-trigger'));assert.equal(after.footer.querySelector('.count-trigger').attributes['aria-haspopup'],'dialog');
});
