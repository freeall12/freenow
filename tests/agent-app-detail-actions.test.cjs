const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture({installed=false,builtin=false}={}){
 class Element{constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.disabled=false;this.attrs={};}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}addEventListener(){}}
 const context={document:{createElement:tag=>new Element(tag)},managerIcons:{exampleArrow:'official-arrow',appSkill:'official-skill'}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/features/agent-manager/app-detail.mjs'),'utf8').replace(/^import .*\n/,'').replace('export function','function')+';this.render=renderAppDetail',context);
 const calls=[],errors=[];let release,fail=false;
 const app={name:'App',id:'app',icon:'/icon',author:'TapNow',description:'Description',examples:['First','Second'],skills:[{name:'Skill',description:'Detail'}],builtin};
 const result=context.render({app,state:{installed,enabled:true},artwork:()=>new Element('img'),toggle:()=>new Element('switch'),onUse:text=>{calls.push(text);return new Promise((resolve,reject)=>{release=()=>fail?reject(Error('write failed')):resolve();});},onInstall:()=>{},onUninstall:()=>{},onError:error=>errors.push(error)});
 const flatten=n=>[n,...n.children.flatMap(flatten)];return{...result,calls,errors,all:flatten(result.body).concat(flatten(result.footer)),release:()=>release(),fail:()=>fail=true};
}
test('example/use share pending state, prevent duplicate invocation, and retain independent install action',async()=>{
 const f=fixture(),rows=f.all.filter(n=>n.className==='manager-example'),install=f.footer.children[0];
 const promise=rows[0].onclick();assert.ok(rows.every(n=>n.disabled));assert.equal(install.disabled,false);await rows[1].onclick();assert.deepEqual(f.calls,['First']);f.release();await promise;assert.ok(rows.every(n=>!n.disabled));
});
test('failed use restores actions and reports failure without invoking a different operation',async()=>{
 const f=fixture({installed:true}),use=f.footer.children.at(-1),remove=f.footer.children[0];f.fail();const promise=use.onclick();assert.equal(remove.disabled,false);assert.equal(use.disabled,true);f.release();await promise;assert.deepEqual(f.calls,[undefined]);assert.deepEqual(f.errors,['write failed']);assert.equal(use.disabled,false);
});
test('system app exposes use but no toggle/uninstall, while skills remain noninteractive',()=>{
 const f=fixture({installed:true,builtin:true});assert.equal(f.all.filter(n=>n.tagName==='switch').length,0);assert.equal(f.footer.children.length,1);assert.equal(f.footer.children[0].textContent,'在对话中使用');assert.equal(f.all.find(n=>n.className==='manager-app-skill').tagName,'div');
});
