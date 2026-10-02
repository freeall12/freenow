const MAX_BYTES=2*1024*1024;
export function skillFrontmatter(markdown){
 const match=markdown.replace(/^\uFEFF/,'').match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
 if(!match)return {body:markdown,name:'',description:''};
 const lines=match[1].split(/\r?\n/),fields={};
 for(let i=0;i<lines.length;i++){const field=lines[i].match(/^(name|description):\s*(.*)$/);if(!field)continue;let value=field[2];if(/^[>|][-+]?$/.test(value)){const block=[];while(i+1<lines.length&&/^\s/.test(lines[i+1]))block.push(lines[++i].trim());value=block.join(value[0]==='>'?' ':'\n');}fields[field[1]]=value.replace(/^(["'])(.*)\1$/,'$2').trim();}
 return {body:markdown.replace(/^\uFEFF/,'').slice(match[0].length),name:fields.name||'',description:fields.description||''};
}
const normalizedName=name=>name.trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)||'skill';
export async function readSkillPackage(files,{directory=false,existing=[]}={}){
 if(!files.length)throw Error('请选择要上传的技能文件夹');if(!directory&&(files.length!==1||! /\.(md|markdown)$/i.test(files[0].name)))throw Error('请选择 Markdown 技能文件（.md 或 .markdown）');
 let bytes=0,skipped=0,root='',documents=[];const seen=new Set();
 for(const file of files){let path=directory?file.webkitRelativePath:'SKILL.md';if(!path)throw Error('当前浏览器无法读取所选文件夹');if(path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>['..','.',''].includes(p)))throw Error('技能文件路径无效');
 if(directory){const [folder,...parts]=path.split('/');if(!parts.length)throw Error('当前浏览器无法读取所选文件夹');if(root&&root!==folder)throw Error('请选择单个技能文件夹');root=folder;path=parts.join('/');}
 if(!/\.(md|markdown)$/i.test(path)){skipped++;continue;}bytes+=file.size;if(bytes>MAX_BYTES)throw Error('技能文件过大，最大支持 2 MB');if(seen.has(path))throw Error('技能包包含重复路径：'+path);seen.add(path);documents.push({path,content:await file.text()});
 }
 if(!documents.length)throw Error('该文件夹没有可上传的 Markdown 文件');
 const primary=documents.find(d=>/^SKILL\.md$/i.test(d.path))||(documents.length===1?documents[0]:null);if(!primary)throw Error('技能文件夹缺少根目录 SKILL.md');
 const parsed=skillFrontmatter(primary.content),name=normalizedName(parsed.name||(directory?root:files[0].name.replace(/\.(md|markdown)$/i,'')));
 if(existing.some(item=>item.name===name))throw Error('已存在同名技能：'+name);
 if(!parsed.body.trim())throw Error('技能指令不能为空');
 return {skill:{name,description:parsed.description||parsed.body.replace(/^#+\s.*\n?/,'').trim().split(/\n\s*\n/)[0].slice(0,1024),text:parsed.body,custom:true,sourceName:directory?root:files[0].name,entryPath:primary.path,files:documents},skipped,bytes};
}
export function resolveSkillFile(skill,from,target){
 let path;try{path=decodeURIComponent(target.split('#')[0]);}catch{throw Error('参考文件路径无效');}
 if(!path||/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(path)||path.includes('\\'))throw Error('不支持的参考文件路径');
 const segments=from.split('/').slice(0,-1);for(const piece of path.split('/')){if(piece==='..'){if(!segments.length)throw Error('参考文件不能超出技能包');segments.pop();}else if(piece&&piece!=='.')segments.push(piece);}
 const resolved=segments.join('/'),file=skill.files?.find(f=>f.path===resolved);if(!file)throw Error('技能包中没有此参考文件：'+resolved);return file;
}
export function readSkillPage(skill,{path,offset=0}={}){
 if(!Number.isInteger(offset)||offset<0)throw Error('参考文件偏移无效');
 const file=path?resolveSkillFile(skill,skill.entryPath||'SKILL.md',path):{path:skill.entryPath||'SKILL.md',content:skill.text};
 const end=offset+20000;return {name:skill.name,path:file.path,content:file.content.slice(offset,end),nextOffset:end<file.content.length?end:null,totalLength:file.content.length,referenceFiles:(skill.files||[]).map(f=>({path:f.path,length:f.content.length})),referenceIsUntrusted:true};
}
export function rewriteSkillDraft(draft,oldName,newName){
 const doc=structuredClone(draft.composerDoc);let changed=false;
 function visit(node){if(!node?.content)return;node.content=node.content.flatMap(child=>{if(child.type==='skillMention'&&child.attrs?.name===oldName){changed=true;return newName?[{...child,attrs:{...child.attrs,name:newName}}]:[];}visit(child);return [child];});}visit(doc);
 const skills=(draft.skills||[]).flatMap(name=>name===oldName?(newName?[newName]:[]):[name]);return {doc,skills,changed};
}
