'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawnSync}=require('node:child_process');
const {isPublicStaticPath}=require('../server/static-public-path.cjs');
const audit=path.resolve(__dirname,'../scripts/audit-public-repository.py');
function repo(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'freenow-public-audit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));execFileSync('git',['init','--quiet',root]);return root;}
function stage(root,file,content){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),content);execFileSync('git',['add','--',file],{cwd:root});}
function scan(root,args=[]){const result=spawnSync('python3',[audit,...args],{cwd:root,encoding:'utf8'});assert.equal(result.error,undefined);return result;}
test('static boundary blocks private captures and development files, keeping runtime resources',()=>{
 for(const file of ['reference/account.json','Reference/account.json','Server/server.cjs','NODE_MODULES/openai/index.js','reference/vendor.js','scripts/audit-public-repository.py','server/server.cjs','tests/fixture.cjs','.env.local','assets/key.pem','assets/capture.har','node_modules/openai/index.js','src/../.env','reference\\account.json'])assert.equal(isPublicStaticPath(file),false,file);
 for(const file of ['index.html','reference/TABLER-LICENSE','runtime-reference/skill.json','docs/research/source.md','src/features/video-tools/entry.js','node_modules/three/build/three.module.js','qa/trim-scenes.mp4'])assert.equal(isPublicStaticPath(file),true,file);
});
test('empty examples and explicit synthetic fixtures pass without hiding genuine-looking provider tokens',t=>{
 const root=repo(t);stage(root,'.env.example','OPENAI_API_KEY=\nOPENAI_MODEL=example-model\n');stage(root,'tests/provider.cjs',"const key='fixture-provider-key';");assert.equal(scan(root).status,0);
 stage(root,'.env.example','OPENAI_API_KEY=fixture-only\n');const filledExample=scan(root);assert.equal(filledExample.status,1);assert.match(filledExample.stdout,/nonempty-example-credential/);stage(root,'.env.example','OPENAI_API_KEY=\n');
 const token=['sk','proj',Buffer.from('synthetic provider detector regression').toString('base64url')].join('-');stage(root,'tests/provider.cjs',`const key='${token}';`);const result=scan(root,['--staged']);assert.equal(result.status,1);assert.match(result.stdout,/openai-like-key/);assert.ok(!result.stdout.includes(token));
});
test('ignored private files cannot silently remain in the Git index',t=>{
 const root=repo(t);stage(root,'reference/account.json','{}');stage(root,'assets/capture.HAR','{}');const result=scan(root);assert.equal(result.status,1);assert.match(result.stdout,/private-file-path/);
});
test('history scan detects a removed token while current index is clean',t=>{
 const root=repo(t),token=['github','pat',Buffer.from('synthetic reachable history regression token').toString('hex')].join('_');stage(root,'old.js',`const key='${token}';`);execFileSync('git',['-c','user.name=Audit Fixture','-c','user.email=audit@example.invalid','commit','--quiet','-m','Synthetic history fixture'],{cwd:root});execFileSync('git',['rm','--quiet','old.js'],{cwd:root});assert.equal(scan(root).status,0);const result=scan(root,['--history']);assert.equal(result.status,1);assert.match(result.stdout,/github-token/);assert.ok(!result.stdout.includes(token));
});
