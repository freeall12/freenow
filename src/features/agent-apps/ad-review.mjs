// Actual packaged ad-review@v1.e990e21f.html: _m/p_/$m/bm/g_/S_.
export const adReviewUri = 'ui://tapnow/ad-review@v1';
export const adReviewPolicy = Object.freeze({allowExpanded:false, autoExpandOnReady:false});
export const adReviewLocales = Object.freeze(['zh-CN','en-US','ja-JP','ko-KR','fr-FR']);
export const adReviewStages = Object.freeze(['frame_cull','pilot_review','final_review']);
export const adReviewMarks = Object.freeze({frame_cull:Object.freeze(['keep','cull']),pilot_review:Object.freeze(['win']),final_review:Object.freeze(['keep','cull','win'])});
export const adReviewBudget = Object.freeze({mediaBytes:8*1024*1024,totalBytes:16*1024*1024,responseBytes:15*1024*1024,timeoutMs:30000});
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = () => {throw Error('广告创意审核数据无效或与已保存评审不一致');};
export function adReviewFields(value, allowed) {if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail();}
export function adReviewText(value, max, required=false) {if(typeof value!=='string'||value.length>max||required&&!value.trim())fail();try{encodeURIComponent(value);}catch{fail();}return value;}
function tokenText(value,max,required=false) {adReviewText(value,max,required);if(/[;|=,\r\n]/.test(value))fail();return value;}
export function prepareAdReview(data,title='广告创意审核') {
  adReviewFields(data,['stage','batch','items','locale']);adReviewText(title,200,true);
  if(!adReviewStages.includes(data.stage)||data.locale!==undefined&&!adReviewLocales.includes(data.locale)||!Array.isArray(data.items)||!data.items.length||data.items.length>48)fail();
  adReviewFields(data.batch,['label','product','note']);
  const batch={};for(const [key,max]of [['label',160],['product',200],['note',2000]])if(data.batch[key]!==undefined)batch[key]=key==='label'?tokenText(data.batch[key],max):adReviewText(data.batch[key],max);
  const items=data.items.map(item=>{
    adReviewFields(item,['combo','media','preview_url','poster_url','node_title','hook','angle','persona','meta']);
    const combo=tokenText(item.combo,120,true);if(['__proto__','prototype','constructor'].includes(combo)||!['image','video'].includes(item.media))fail();
    const copy={combo,media:item.media};
    for(const [key,max]of [['node_title',200],['hook',300],['angle',300],['persona',300],['meta',1000]])if(item[key]!==undefined)copy[key]=adReviewText(item[key],max);
    for(const key of ['preview_url','poster_url'])if(item[key]!==undefined){
      const url=adReviewText(item[key],12*1024*1024,true),kind=key==='poster_url'?'image':item.media;
      if(!(kind==='image'?/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/:/^data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/]+={0,2}$/).test(url)&&!/^blob:/.test(url))fail();copy[key]=url;
    }
    return copy;
  });
  if(new Set(items.map(item=>item.combo)).size!==items.length)fail();
  const result={title,stage:data.stage,batch,items,locale:data.locale||'zh-CN'};
  if(new TextEncoder().encode(JSON.stringify(result)).length>adReviewBudget.responseBytes)throw Error('广告审核本地预览超过15MiB，请减少素材后重试');return result;
}
function prepared(response) {adReviewFields(response,['title','stage','batch','items','locale']);const {title,...data}=response;return prepareAdReview(data,title);}
export function initialAdReviewState(response) {prepared(response);return {marks:{},notes:{}};}
export function validateAdReviewState(value,response) {
  const source=prepared(response),ids=source.items.map(item=>item.combo);adReviewFields(value,['marks','notes']);adReviewFields(value.marks,ids);adReviewFields(value.notes,ids);
  const marks={},notes={};for(const [key,mark]of Object.entries(value.marks)){if(!adReviewMarks[source.stage].includes(mark))fail();marks[key]=mark;}
  for(const [key,note]of Object.entries(value.notes)){adReviewText(note,60);if(!note)fail();notes[key]=note;}return {marks,notes};
}
export function cleanAdReviewNote(value) {const clean=value.replace(/[\r\n]+/g,' ').replace(/[;|=]/g,'').replace(/\s+/g,' ').trim();return {text:clean.slice(0,60),truncated:clean.length>60};}
export function adReviewVerdict(response,savedState) {
  const source=prepared(response),state=validateAdReviewState(savedState,source),keep=[],cull=[],win=[];
  for(const {combo}of source.items){const mark=state.marks[combo];if(source.stage==='frame_cull')(mark==='keep'?keep:cull).push(combo);else if(source.stage==='pilot_review'){if(mark==='win')win.push(combo);}else{if(mark==='win')win.push(combo);(mark==='cull'?cull:keep).push(combo);}}
  return {keep,cull,win};
}
export function adReviewToken(response,savedState) {
  const source=prepared(response),state=validateAdReviewState(savedState,source),verdict=adReviewVerdict(source,state),parts=['v=1',`stage=${source.stage}`,`batch=${source.batch.label??''}`];
  if(source.stage!=='pilot_review')parts.push(`keep=${verdict.keep.join(',')}`,`cull=${verdict.cull.join(',')}`);
  if(source.stage==='pilot_review'||source.stage==='final_review'&&verdict.win.length)parts.push(`win=${verdict.win.join(',')}`);
  for(const {combo}of source.items){const note=cleanAdReviewNote(state.notes[combo]||'').text;if(note)parts.push(`n.${combo}=${note}`);}return parts.join(';');
}
const summaries=Object.freeze({
 'zh-CN':['首帧快筛完成：保留 {k} · 淘汰 {c}','试拍评审完成：{w} 支胜出','成片验收完成：收 {k} · 回炉 {c}'],
 'en-US':['Frame cull done: keep {k} · cull {c}','Pilot review done: {w} winner(s)','Final review done: keep {k} · rework {c}'],
 'ja-JP':['フレーム選別完了：採用 {k} · 除外 {c}','試作評価完了：{w} 件を選出','完成動画確認完了：採用 {k} · 修正 {c}'],
 'ko-KR':['프레임 선별 완료: 유지 {k} · 제외 {c}','시안 검토 완료: {w}개 선정','최종 검수 완료: 유지 {k} · 재작업 {c}'],
 'fr-FR':['Sélection terminée : {k} gardées · {c} rejetées','Évaluation des essais terminée : {w} sélection(s)','Validation finale : {k} gardés · {c} à retravailler'],
});
const escapes=Object.freeze({
 'zh-CN':['这批首帧方向都不对，回钩子库重新选方向。','试拍一个都看不上，回钩子库换一批。','成片都不行，回炉重做。'],
 'en-US':['None of these frame directions work - back to the hook library to repick.','None of the pilots stand out - back to the hook library for a new batch.','None of the finals pass - send them back to production for rework.'],
 'ja-JP':['今回のフレームの方向性は合いません。フックライブラリから選び直してください。','良い試作がありません。フックライブラリから新しい候補を選んでください。','完成動画はすべて不採用です。制作に戻して修正してください。'],
 'ko-KR':['이번 프레임 방향은 모두 맞지 않습니다. 후크 라이브러리에서 다시 골라 주세요.','마음에 드는 시안이 없습니다. 후크 라이브러리에서 새 후보를 골라 주세요.','최종 영상이 모두 부적합합니다. 제작 단계로 돌아가 재작업해 주세요.'],
 'fr-FR':['Aucune direction ne convient. Reprenez la bibliothèque d’accroches pour en choisir d’autres.','Aucun essai ne convient. Choisissez de nouvelles propositions dans la bibliothèque d’accroches.','Aucune vidéo finale ne convient. Renvoyez-les en production pour les retravailler.'],
});
export async function resolveAdReviewReply(message,response,savedState) {
  adReviewText(message,16384,true);const source=prepared(response),index=adReviewStages.indexOf(source.stage);
  const escape=message===escapes[source.locale][index];let result;
  if(escape)result={stage:source.stage,batch:source.batch,decision:'reject_batch',items:source.items.map(({preview_url,poster_url,...item})=>item)};
  else {
    const state=validateAdReviewState(savedState,source),verdict=adReviewVerdict(source,state);if(!(source.stage==='pilot_review'?verdict.win.length:verdict.keep.length))fail();
    const counts={k:verdict.keep.length,c:verdict.cull.length,w:verdict.win.length};let summary=summaries[source.locale][index];for(const [key,value]of Object.entries(counts))summary=summary.split(`{${key}}`).join(String(value));
    if(message!==`${summary} — AR1 ${adReviewToken(source,state)}`)fail();
    result={stage:source.stage,batch:source.batch,decision:'review_confirmed',...verdict,passed_over:source.stage==='pilot_review'?source.items.filter(item=>!verdict.win.includes(item.combo)).map(item=>item.combo):[],items:source.items.map(({preview_url,poster_url,...item})=>({...item,mark:state.marks[item.combo]??null,note:cleanAdReviewNote(state.notes[item.combo]||'').text}))};
  }
  const prompt=`${message}\n\n已核对本应用当前广告创意审核阶段与保存结果。此结论是用户的创意判断，不能称作真实投放数据验证、平台合规通过或模型审核结果。首帧只是分镜预览；试拍未选中项留在画布；成片回炉只形成修改方案。请按实际阶段整理下一步方案。此确认不授权媒体生成、投放、删除、额外支出或其他工具修改，后续执行仍走正常确认。\n${JSON.stringify(result)}`;
  if(prompt.length>16384)throw Error('广告审核交接过长，请缩短素材说明后重试');
  const identity={source:{stage:source.stage,batch:source.batch,items:source.items},result},digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity)));
  return {kind:escape?'reject_batch':'confirmed',text:prompt,metadata:{handoffId:'ad_review_'+[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')},result};
}
