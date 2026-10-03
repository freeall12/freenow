const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

// Execute the real import callback with its runtime boundary replaced. Loading createUI
// would also start the unrelated rich-text composer and WebGL preview in this unit test.
const source=fs.readFileSync(require.resolve('../src/features/studio-v2/ui.mjs'),'utf8');
const callback=source.slice(source.indexOf('  async function add(kind)'),source.indexOf('  function importMenu(trigger)'));

test('completed imports restore their origin trigger even when runtime moves focus, and stale callbacks leave a new popup alone',async()=>{
  for(const {kind,applied,replace} of [{kind:'sphere'},{kind:null},{kind:'sphere',applied:true},{kind:'sphere',replace:true},{kind:null,applied:true,replace:true}]){
    const calls=[],origin={querySelector:()=>({value:'2'})},context={popup:origin,prepared:{defaultScene:0},importing:false,modelFile:{},resources:[],error:'',
      renderImport:()=>calls.push('render'),closePopup:restore=>calls.push(['close',restore]),notice:message=>calls.push(['notice',message])};
    context.releasePrepared=()=>{context.prepared=null;calls.push('release');};
    const execute=async()=>{
      // Runtime adds select/focus the new object. Returning focus must not depend on
      // whether the popover still owns document.activeElement at completion.
      context.focus='viewport';if(replace)context.popup={};
      if(applied)throw Object.assign(Error('quota'),{applied:true});
    };
    context.runtime={add:async value=>{calls.push(['shape',value]);await execute();},importPrepared:async(value,index)=>{calls.push(['import',index]);await execute();}};
    vm.runInNewContext(callback+'\nthis.runAdd=add;',context);await context.runAdd(kind);
    assert.equal(context.importing,false);
    assert.equal(calls.filter(call=>Array.isArray(call)&&call[0]==='close').length,replace?0:1);
    if(!replace)assert.deepEqual(calls.find(call=>Array.isArray(call)&&call[0]==='close'),['close',true]);
    if(kind===null)assert.deepEqual(calls.find(call=>Array.isArray(call)&&call[0]==='import'),['import',2]);
    assert.match(calls.at(-1)[1],applied?/本地修改已保留/:/已添加并保存/);
  }
});
