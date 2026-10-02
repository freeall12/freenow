const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

async function harness({compact=false,value=null,busy=false,direction='ltr'}={}){
 const {bindRadioGroup}=await import('../src/features/agent-forms/radio-group.mjs');
 const {compactOptions}=await import('../src/features/agent-forms/model.mjs');
 const document={activeElement:null};global.document=document;global.getComputedStyle=()=>({direction});
 class Element{
  constructor(tag,cls='',text){this.tag=tag;this.className=cls;this.textContent=text;this.children=[];this.dataset={};this.tabIndex=0;this.classList={add:(value)=>this.className+=' '+value};}
  append(...items){this.children.push(...items);}
  contains(target){return this===target||this.children.some(item=>item.contains?.(target));}
  focus(){document.activeElement=this;this.onfocus?.();}
  click(){if(!this.disabled)this.onclick?.();}
 }
 const el=(...args)=>new Element(...args),button=(label,cls,click)=>Object.assign(el('button',cls,label),{onclick:click});
 const field={id:'style',type:'radio',label:'镜头风格',options:['a','b','c'].map(value=>({value,label:value,...(!compact?{description:'解释 '+value}:{})}))};
 const values={style:value},syncers=new Map(),changes=[];
 const context={el,button,icon:()=>el('span'),compactOptions,bindRadioGroup,values,syncers,inactive:()=>busy,change(field,value){if(busy)return;values[field.id]=value;changes.push(value);syncers.get(field.id)?.();}};
 const source=fs.readFileSync(require.resolve('../src/features/agent-forms/view.mjs'),'utf8');
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' function control('),source.indexOf(' function calendar(')),context);
 const group=context.control(field),items=group.children;
 const key=(item,key,extra={})=>{const event={key,...extra,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};item.onkeydown?.(event);return event;};
 return {group,items,key,values,changes,document,setBusy:value=>busy=value};
}

test('described radio uses one tab stop and arrow keys select, persist and wrap',async()=>{
 const {group,items,key,values,changes,document}=await harness({value:'b'});
 assert.equal(group.role,'radiogroup');assert.equal(group.ariaLabel,'镜头风格');
 assert.deepEqual(items.map(item=>[item.role,item.ariaChecked,item.tabIndex]),[['radio','false',-1],['radio','true',0],['radio','false',-1]]);
 assert.equal(items[0].ariaPressed,undefined);
 key(items[1],'ArrowRight');assert.equal(values.style,'c');assert.equal(document.activeElement,items[2]);
 key(items[2],'ArrowDown');assert.equal(values.style,'a');
 key(items[0],'ArrowLeft');assert.equal(values.style,'c');
 key(items[2],'ArrowUp');assert.equal(values.style,'b');
 assert.deepEqual(changes,['c','a','c','b']);assert.deepEqual(items.map(item=>item.tabIndex),[-1,0,-1]);
});
test('Home End and Page navigation move focus without changing the submitted value',async()=>{
 const {group,items,key,values,changes,document}=await harness({value:'b'});
 for(const [command,index] of [['Home',0],['End',2],['PageUp',0],['PageDown',2]]){
  assert.equal(key(document.activeElement||items[1],command).defaultPrevented,true);
  assert.equal(document.activeElement,items[index]);assert.equal(values.style,'b');
 }
 assert.deepEqual(changes,[]);document.activeElement=null;group.onfocusout();await Promise.resolve();
 assert.deepEqual(items.map(item=>item.tabIndex),[-1,0,-1]);
});
test('Enter is suppressed while Space remains a native button action and busy state blocks navigation',async()=>{
 const {items,key,values,changes,setBusy,document}=await harness();
 assert.deepEqual(items.map(item=>item.tabIndex),[0,-1,-1]);
 assert.equal(key(items[0],'Enter').defaultPrevented,true);assert.equal(values.style,null);
 assert.equal(key(items[0],' ').defaultPrevented,false);items[0].click();assert.equal(values.style,'a');
 assert.equal(key(items[0],'ArrowRight',{ctrlKey:true}).defaultPrevented,false);assert.equal(values.style,'a');
 setBusy(true);assert.equal(key(items[0],'ArrowRight').defaultPrevented,false);assert.equal(document.activeElement,null);assert.deepEqual(changes,['a']);
});
test('RTL reverses only horizontal navigation and disabled options are skipped',async()=>{
 const {items,key,values}=await harness({value:'b',direction:'rtl'});
 key(items[1],'ArrowRight');assert.equal(values.style,'a');
 items[1].disabled=true;key(items[0],'ArrowDown');assert.equal(values.style,'c');
});
test('official short-label chips remain independent deselectable buttons',async()=>{
 const {group,items,values}=await harness({compact:true,value:'b'});
 assert.equal(group.role,undefined);assert.equal(items[1].ariaPressed,'true');assert.equal(items[1].onkeydown,undefined);
 items[1].click();assert.equal(values.style,null);assert.equal(items[1].ariaPressed,'false');
 items[0].click();assert.equal(values.style,'a');assert.equal(items[0].ariaPressed,'true');
});
