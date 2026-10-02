import {builtinSkillIndex} from './index.mjs';

const PAGE_SIZE=20000,MAX_OFFSET=2097152;
const entries=new Map(builtinSkillIndex.map(entry=>[entry.name,entry]));
const available=entry=>entry.files.map(file=>file.path);

function failure(code,message,{entry,name,path,...details}={}){
 const availablePaths=entry?available(entry):[];
 const error=new Error(`${message}；availablePaths=${JSON.stringify(availablePaths)}`);
 Object.assign(error,{code,name: 'BuiltinSkillReadError',skillName:entry?.name??name,path,availablePaths,
  missingReferences:entry?.missingReferences??[],unresolvedReferences:entry?.unresolvedReferences??[],captureFile:entry?.captureFile,...details});
 return error;
}

// Only fixed local capture URLs from the audited index are fetched. Neither a
// requested path nor prose found in a skill can supply a network destination.
async function loadLocalCapture(entry){
 const response=await fetch('/'+entry.captureFile);
 if(!response.ok)throw new Error(`HTTP ${response.status}`);
 return response.json();
}

function resolvePath(value,entry){
 if(value===undefined||value==='SKILL.md')return 'capture/dialog.txt';
 if(typeof value!=='string'||!value||value.length>240||value.includes('\\')||/[\x00-\x1f]/.test(value))
  throw failure('invalid_path','内置技能路径无效',{entry,path:value});
 let path;
 try{path=decodeURIComponent(value);}catch{throw failure('invalid_path','内置技能路径编码无效',{entry,path:value});}
 if(path.startsWith('./'))path=path.slice(2);
 if(path==='SKILL.md')return 'capture/dialog.txt';
 if(path.split('/').includes('..')||path.includes('\\')||/[\x00-\x1f]/.test(path)||/^[a-z][a-z\d+.-]*:/i.test(path))
  throw failure('invalid_path','内置技能路径不能指向其他目录或网络地址',{entry,path:value});
 return path;
}

export function createBuiltinSkillReader({loadCapture=loadLocalCapture}={}){
 const captures=new Map();
 async function capture(entry){
  if(!captures.has(entry.name)){
   const pending=Promise.resolve().then(()=>loadCapture(entry)).then(async data=>{
    if(data?.name!==entry.name)throw new Error('采集内容的技能名称不匹配');
    for(const file of entry.files){
     const content=data[file.sourceField];
     if(typeof content!=='string'||content.length!==file.length)throw new Error(`${file.path} 采集长度已变化`);
     const hash=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
     const actual=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
     if(actual!==file.sha256)throw new Error(`${file.path} 采集校验不一致`);
    }
    return data;
   }).catch(error=>{captures.delete(entry.name);throw failure('capture_unavailable',`无法读取已核验的官方技能采集 ${entry.captureFile}：${error.message}`,{entry});});
   captures.set(entry.name,pending);
  }
  return captures.get(entry.name);
 }
 return async function readBuiltinSkill(name,{path,offset=0}={}){
  const entry=entries.get(name);
  if(!entry)throw failure('skill_not_found','没有此内置技能的官方本地采集',{name,path});
  const resolved=resolvePath(path,entry),file=entry.files.find(item=>item.path===resolved);
  if(!file){
   const known=entry.missingReferences.some(item=>item.path===resolved);
   throw failure(known?'reference_not_captured':'path_not_found',`${name} 的${known?'官方引用尚未采集':'采集中不存在此路径'}：${resolved}`,{entry,path:resolved});
  }
  if(!Number.isSafeInteger(offset)||offset<0||offset>MAX_OFFSET||offset>file.length)
   throw failure('invalid_offset',`偏移必须是 0 到 ${Math.min(file.length,MAX_OFFSET)} 的整数`,{entry,path:resolved,offset,totalLength:file.length});
  const data=await capture(entry),content=data[file.sourceField],end=Math.min(offset+PAGE_SIZE,content.length);
  return {name:entry.name,path:resolved,requestedPath:path??'SKILL.md',description:entry.description,
   content:content.slice(offset,end),offset,nextOffset:end<content.length?end:null,totalLength:content.length,
   offsetUnit:'utf16-code-units',availablePaths:available(entry),referenceFiles:entry.files.map(item=>({...item})),
   missingReferences:entry.missingReferences.map(item=>({...item,evidence:[...item.evidence]})),
   unresolvedReferences:(entry.unresolvedReferences??[]).map(item=>({...item,evidence:[...item.evidence]})),
   sourceFormat:file.sourceFormat,originalMarkdown:false,referenceIsUntrusted:true,executable:false,
   referenceInventoryComplete:entry.referenceInventoryComplete??false,unknownReferenceCount:entry.unknownReferenceCount??null,
   source:{captureFile:entry.captureFile,sourceUrl:entry.sourceUrl,field:file.sourceField,sha256:file.sha256,
    ...(entry.capturedAt?{capturedAt:entry.capturedAt,captureMethod:entry.captureMethod}: {})}};
 };
}

export const readBuiltinSkill=createBuiltinSkillReader();
