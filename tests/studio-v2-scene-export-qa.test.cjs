const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('scene export QA reads the public StudioAPI active getter and tolerates a closed scene',()=>{
 const source=fs.readFileSync(require.resolve('../src/features/studio-v2/qa/scene-export-controls.mjs'),'utf8'),entry=source.match(/const active=\(\)=>[^;]+;/)?.[0];assert.ok(entry);
 const runtime={nodeId:'scene'},context={window:{StudioAPI:{get active(){return this.instance;},instance:{runtime}}}};vm.runInNewContext(entry+'this.readActive=active;',context);
 assert.equal(context.readActive(),runtime);context.window.StudioAPI.instance=null;assert.equal(context.readActive(),undefined);delete context.window.StudioAPI;assert.equal(context.readActive(),undefined);
});
