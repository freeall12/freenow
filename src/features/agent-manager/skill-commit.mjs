import {validateSkill} from './model.mjs';

const skillsKey='tapnow-custom-skills', receiptsKey='tapnow-skill-commits-v1';
const maxBytes=2*1024*1024, encoder=new TextEncoder();
const fail=(code,message)=>Object.assign(new Error(message),{code});
const contentOf=skill=>({name:skill.name,description:skill.description||'',text:skill.text||'',entryPath:skill.entryPath||'SKILL.md',files:[...(skill.files||[])].map(({path,content})=>({path,content})).sort((a,b)=>a.path.localeCompare(b.path))});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(canonical(value))))),byte=>byte.toString(16).padStart(2,'0')).join('');
export const skillVersion=skill=>digest(contentOf(skill));
function readArray(storage,key){const value=JSON.parse(storage.getItem(key)||'[]');if(!Array.isArray(value))throw Error('技能存储格式无效');return value;}
function referenceFiles(input,previous){
 const files=input.files===undefined?(previous?.files||[]).filter(file=>file.path!==(previous.entryPath||'SKILL.md')):input.files;
 if(!Array.isArray(files)||files.length>100)throw Error('技能参考文件最多100个');
 const seen=new Set();return files.map(file=>{
  if(!file||typeof file.path!=='string'||typeof file.content!=='string'||Object.keys(file).some(key=>!['path','content'].includes(key)))throw Error('技能参考文件无效');
  const path=file.path;
  if(path.length>240||! /\.(md|markdown)$/i.test(path)||/[\\\x00-\x1f\x7f%?#:]/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..')||/^SKILL\.md$/i.test(path))throw Error('技能参考文件路径无效：'+path);
  if(seen.has(path))throw Error('技能包包含重复路径：'+path);seen.add(path);return {path,content:file.content};
 });
}
let queued=Promise.resolve();
function withSkillLock(run){
 const locked=()=>globalThis.navigator?.locks?.request?globalThis.navigator.locks.request('tapnow-personal-skills',async()=>run()):run();
 const result=queued.then(locked,locked);queued=result.catch(()=>{});return result;
}
export function commitSkill(input,{storage=localStorage,builtinNames=[]}={}){
 return withSkillLock(()=>commit(input,{storage,builtinNames}));
}
// Manager forms carry their original record, so an old form cannot silently
// replace an Agent edit. Apply one record to the latest collection under lock.
export function updatePersonalSkill({skill,previous,builtinNames=[]},{storage=localStorage}={}){
 return withSkillLock(()=>{
  const current=readArray(storage,skillsKey),existing=previous&&current.find(item=>item.name===previous.name);
  if(previous&&(!existing||JSON.stringify(canonical(contentOf(existing)))!==JSON.stringify(canonical(contentOf(previous)))))throw fail('version_conflict','技能已被其他操作更新，请重新打开编辑页后保存');
  if(skill&&(builtinNames.includes(skill.name)||current.some(item=>item.name===skill.name&&item!==existing)))throw fail('name_conflict','已存在同名技能：'+skill.name);
  if(!skill&&!previous)throw Error('缺少要更新的技能');
  const next=current.filter(item=>item!==existing);if(skill)next.push(skill);
  storage.setItem(skillsKey,JSON.stringify(next));return skill||null;
 });
}
async function commit(input,{storage,builtinNames}){
 if(!input||typeof input.operation_id!=='string'||! /^[a-zA-Z0-9_-]{8,128}$/.test(input.operation_id))throw Error('技能提交 operation_id 无效');
 if(typeof input.base_version!=='string'||! /^(0|[a-f0-9]{64})$/.test(input.base_version))throw Error('技能版本无效；创建使用0，更新先读取当前版本');
 const skillsRaw=storage.getItem(skillsKey),receiptsRaw=storage.getItem(receiptsKey);
 const current=readArray(storage,skillsKey),receipts=readArray(storage,receiptsKey),prior=receipts.find(item=>item.operationId===input.operation_id);
 const signature=await digest(input);
 if(prior&&prior.signature!==signature)throw fail('operation_conflict','同一 operation_id 不能用于不同的技能提交');
 if(prior?.status==='committed'){const latest=current.find(skill=>skill.name===prior.result.name),currentVersion=latest?await skillVersion(latest):null;return {...prior.result,replayed:true,currentVersion,currentMatches:currentVersion===prior.result.version};}
 const previous=current.find(skill=>skill.name===input.name),actualVersion=previous?await skillVersion(previous):'0';
 if(prior){
  if(actualVersion!==prior.result.version)throw fail('commit_conflict','上一提交的保存结果不确定，技能内容已变化；请读取当前技能后重新确认');
  if(storage.getItem(skillsKey)!==skillsRaw||storage.getItem(receiptsKey)!==receiptsRaw)throw fail('version_conflict','技能库已变化，请重试同一 operation_id');
  storage.setItem(receiptsKey,JSON.stringify(receipts.map(item=>item===prior?{...item,status:'committed'}:item)));
  return {...prior.result,replayed:true};
 }
 if(builtinNames.includes(input.name))throw Error('不能覆盖官方内置技能');
 if(actualVersion!==input.base_version)throw fail('version_conflict','技能版本已变化；请读取当前技能后使用新的 operation_id 提交');
 const validated=validateSkill({name:input.name,description:input.description,instructions:input.instructions,text:input.instructions},current,previous?.name);
 // Canonical names are exact identifiers; whitespace must not redirect a commit.
 if(validated.name!==input.name)throw Error('技能名称不能包含首尾空格');
 const references=referenceFiles(input,previous),entry={path:'SKILL.md',content:'---\nname: '+validated.name+'\ndescription: '+JSON.stringify(validated.description)+'\n---\n'+validated.text};
 if(encoder.encode([entry,...references].map(file=>file.content).join('')).byteLength>maxBytes)throw Error('技能文件过大，最大支持 2 MB');
 const skill={...previous,...validated,entryPath:'SKILL.md',files:[entry,...references]},version=await skillVersion(skill);
 const result={name:skill.name,version,created:!previous,saved:true,referenceFiles:references.map(file=>file.path)};
 if(storage.getItem(skillsKey)!==skillsRaw||storage.getItem(receiptsKey)!==receiptsRaw)throw fail('version_conflict','技能库已变化，请重试同一 operation_id');
 const receipt={operationId:input.operation_id,signature,status:'prepared',result};
 // Write-ahead receipt lets a lost result retry confirm the committed content,
 // without overwriting an intervening manual edit or recreating a deleted skill.
 storage.setItem(receiptsKey,JSON.stringify([...receipts,receipt]));
 try{storage.setItem(skillsKey,JSON.stringify([...current.filter(item=>item.name!==skill.name),skill]));}
 catch(error){try{if(receiptsRaw===null)storage.removeItem(receiptsKey);else storage.setItem(receiptsKey,receiptsRaw);}catch{}throw error;}
 storage.setItem(receiptsKey,JSON.stringify([...receipts,{...receipt,status:'committed'}]));
 return result;
}
