'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=require('node:path').resolve(__dirname,'..');
function element(){return {children:[],dataset:{},isConnected:true,setAttribute(){},append(...items){this.children.push(...items);},focus(){this.focused=true;}};}
function editorClass(){
 const context={window:{IMAGE_EDITOR_ICONS:{},CanvasApp:{}},document:{addEventListener(){},createElement:element},FabricObject:{},config:{},createImageEditorAgent:()=>({}),Rect:class{},Ellipse:class{},Line:class{},Path:class{},Textbox:class{},FabricImage:class{},StaticCanvas:class{},Group:class{},Point:class{},util:{}};
 const source=fs.readFileSync(root+'/image-editor-entry.mjs','utf8').replace(/^import .*;\n/gm,'');vm.runInNewContext(source+'\nthis.EditorClass=ImageEditor;',context);return context.EditorClass;
}
test('editor repeated close uses one dirty prompt and a stale save receipt never closes newer edits',async()=>{
 const Editor=editorClass(),modals=[],editor=Object.create(Editor.prototype);let closed=0,resolveSave;
 Object.assign(editor,{alive:true,width:600,height:400,document:()=>({draft:true}),saved:'{}',field(){},status(){},close(){closed++;},modal(){const modal={root:element(),body:element(),actions:element(),close:element()};modals.push(modal);return modal;},save:()=>new Promise(resolve=>resolveSave=resolve)});
 editor.requestClose();editor.requestClose();assert.equal(modals.length,1);assert.ok(modals[0].close.focused);assert.equal(closed,0);
 const save=modals[0].actions.children[1],pending=save.onclick();await Promise.resolve();assert.equal(save.disabled,true);resolveSave({saved:true,currentMatches:false});await pending;assert.equal(closed,0);assert.equal(save.disabled,false);
 const next=save.onclick();await Promise.resolve();resolveSave({saved:true,currentMatches:true});await next;assert.equal(closed,1);
});
test('mask drafts require explicit discard; repeated requests reuse confirmation and cancel preserves draft',()=>{
 const source=fs.readFileSync(root+'/image-erase-ui.mjs','utf8'),classSource=source.slice(source.indexOf('export class Erase'),source.indexOf('\nexport function open')).replace('export class','class');let confirmations=0,options;
 const context={confirmDiscard(args){confirmations++;options=args;return {element:{isConnected:true,querySelector:()=>({focus(){}})}};}};vm.runInNewContext(classSource+';this.EraseClass=Erase;',context);
 const editor=Object.create(context.EraseClass.prototype);let closed=0;Object.assign(editor,{alive:true,history:['empty','painted'],root:element(),closeMenu(){},hideTip(){},close(){closed++;}});
 editor.requestClose();editor.requestClose();assert.equal(confirmations,1);assert.equal(closed,0);options.onCancel();assert.equal(closed,0);assert.equal(editor.dismissal,null);
 editor.requestClose();assert.equal(confirmations,2);options.onDiscard();assert.equal(closed,1);
});
test('crop/outpaint drafts compare logical selection rather than viewport geometry',()=>{
 const source=fs.readFileSync(root+'/image-outpaint-ui.mjs','utf8'),classSource=source.slice(source.indexOf('export class Outpaint'),source.indexOf('\nexport function open')).replace('export class','class');let prompts=0;const context={confirmDiscard(){prompts++;return {element:element()};}};vm.runInNewContext(classSource+';this.OutpaintClass=Outpaint;',context);
 const editor=Object.create(context.OutpaintClass.prototype);let closed=0;Object.assign(editor,{alive:true,selection:{x:.1,y:.1,width:.8,height:.8},values:{count:1},root:element(),closeMenu(){},hideTip(){},close(){closed++;}});editor.initialDraft=editor.draftState();editor.rect={x:200,y:100,width:300,height:300};editor.requestClose();assert.equal(closed,1);assert.equal(prompts,0);
 editor.selection.width=.5;editor.requestClose();assert.equal(prompts,1);assert.equal(closed,1);
});
