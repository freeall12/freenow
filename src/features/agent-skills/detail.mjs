import {readBuiltinSkill} from './reader.mjs';

// Prefer genuine captured article DOM when available, with rendered dialog text
// as the fallback. Consumers must sanitize HTML; neither is original Markdown.
export async function readBuiltinSkillDetail(name,{readSkill=readBuiltinSkill}={}){
 const first=await readSkill(name);
 const path=first.availablePaths.includes('capture/article.html')?'capture/article.html':first.path;
 let page=path===first.path?first:await readSkill(name,{path}),content=page.content;
 while(page.nextOffset!==null){
  page=await readSkill(name,{path,offset:page.nextOffset});
  content+=page.content;
 }
 return {...page,content,offset:0};
}
