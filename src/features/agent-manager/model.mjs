export function validateSkill(input,existing=[],previousName){
 const name=input.name.trim(),description=input.description.trim(),text=input.text.trim();
 if(!/^[a-z0-9-]{1,64}$/.test(name))throw Error('技能名称只允许小写字母、数字和连字符，最多64个字符');
 if(existing.some(s=>s.name===name&&s.name!==previousName))throw Error('已存在同名技能');
 if(!description)throw Error('请输入描述');if(description.length>1024)throw Error('描述不能超过1024个字符');if(!text)throw Error('请输入指令');if(text.length>20000)throw Error('技能指令不能超过20000个字符');
 return {name,description,text,custom:true};
}
// Installation is adapter-confirmed; catalog visibility never implies executable tools.
export function createAppRegistry({storage,adapter=()=>null,catalog}){
 const key='tapnow-agent-app-state-v1';
 const read=()=>{try{return JSON.parse(storage.getItem(key)||'{}');}catch{return {};}};
 const state=id=>{const item=catalog.find(a=>a.id===id);if(!item)throw Error('应用不存在');return {installed:item.installed,enabled:true,...read()[id]};};
 const write=(id,value)=>{storage.setItem(key,JSON.stringify({...read(),[id]:value}));return value;};
 return {state,async install(id){const item=catalog.find(a=>a.id===id);if(!item)throw Error('应用不存在');const provider=adapter();if(!provider?.install)throw Error('应用安装接口尚未配置');const result=await provider.install({id});if(result?.installed!==true)throw Error(result?.error||'应用安装未完成');return write(id,{installed:true,enabled:true});},async uninstall(id){if(catalog.find(a=>a.id===id)?.builtin)throw Error('内置应用不可卸载');const provider=adapter();if(!provider?.uninstall)throw Error('应用卸载接口尚未配置');const result=await provider.uninstall({id});if(result?.uninstalled!==true)throw Error(result?.error||'应用卸载未完成');return write(id,{installed:false,enabled:false});},enable(id,enabled){return write(id,{...state(id),enabled});}};
}
