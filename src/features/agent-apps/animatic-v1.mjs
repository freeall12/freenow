// Pure geometry and AN1 v1 helpers extracted from official animatic@v1.7f4d2fcb.
const De=e=>Math.round(e*1e6)/1e6;function rr(e,n){if(!Number.isFinite(e)||e<=0)throw new Error(`${n} must be a finite positive number`)}function Em(e,n,r){if(rr(n,"width"),rr(r,"height"),![e.x,e.y,e.w,e.h].every(Number.isFinite))throw new Error("normalized cell rectangle must be finite");if(e.x<0||e.y<0||e.w<=0||e.h<=0||e.x+e.w>1||e.y+e.h>1)throw new Error("normalized cell rectangle must stay inside the source image");return{x:De(e.x*n),y:De(e.y*r),width:De(e.w*n),height:De(e.h*r)}}function et(e,n,r,o){const t=e.width*n,i=e.height*n,a=e.x+e.width-t,s=e.y+e.height-i,c=e.x+r*e.width-t/2,u=e.y+o*e.height-i/2;return{x:De(Math.min(a,Math.max(e.x,c))),y:De(Math.min(s,Math.max(e.y,u))),width:De(t),height:De(i)}}function Hs(e,n,r){if(rr(e.width,"cell.width"),rr(e.height,"cell.height"),![e.x,e.y].every(Number.isFinite))throw new Error("cell origin must be finite");if(!Number.isFinite(r))throw new Error("progress must be finite");const o=Math.min(1,Math.max(0,r));switch(n){case"static":return{...e};case"push_in":return et(e,1-.18*o,.5,.5);case"pull_out":return et(e,.82+.18*o,.5,.5);case"pan_left":return et(e,.86,.57-.14*o,.5);case"pan_right":return et(e,.86,.43+.14*o,.5);case"tilt_up":return et(e,.86,.5,.57-.14*o);case"tilt_down":return et(e,.86,.5,.43+.14*o);default:throw new Error(`unsupported camera move: ${String(n)}`)}}function Vs(e,n){if(!Number.isInteger(e)||e<0)throw new Error(`${n} must be a non-negative integer`)}function z_(e,n,r){if(Vs(e,"sheetCount"),Vs(n,"shotCount"),!Number.isFinite(r)||r<0)throw new Error("duration must be a finite non-negative number");return`AN1 v=1;a=confirm;sheets=${e};shots=${n};dur=${r.toFixed(1)}`}function x_(){return"AN1 v=1;a=reject"}
const copy={
  "zh-CN": {
    "confirmSummary": "动态分镜确认：{sheets} 张故事板，{shots} 镜，{duration} 秒",
    "rejectSummary": "动态分镜未通过，返回镜头拆解"
  },
  "en-US": {
    "confirmSummary": "Animatic confirmed: {sheets} boards, {shots} shots, {duration} seconds",
    "rejectSummary": "Animatic rejected; return to the shot breakdown"
  },
  "ja-JP": {
    "confirmSummary": "アニマティック確認：{sheets} シート、{shots} ショット、{duration} 秒",
    "rejectSummary": "アニマティックを差し戻し、ショット分解へ戻る"
  },
  "ko-KR": {
    "confirmSummary": "애니매틱 확인: {sheets}장, {shots}숏, {duration}초",
    "rejectSummary": "애니매틱을 반려하고 숏 분해로 돌아갑니다"
  },
  "fr-FR": {
    "confirmSummary": "Animatique confirmée : {sheets} planches, {shots} plans, {duration} secondes",
    "rejectSummary": "Animatique refusée ; retour au découpage"
  }
};
export const animaticV1Uri='ui://tapnow/animatic@v1';
export const animaticV1Policy=Object.freeze({allowExpanded:true,autoExpandOnReady:true});
export const animaticV1Limits=Object.freeze({sourceBytes:16*1024*1024,totalBytes:64*1024*1024,dataBytes:4*1024*1024,timeoutMs:30000});
const clone=v=>structuredClone(v),fail=(message='历史动态分镜数据无效')=>{throw Object.assign(Error(message),{code:'invalid_animatic_v1'});};
function fields(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail();}
function text(value,max,optional=false){if(optional&&value===undefined)return;if(typeof value!=='string'||!value.trim()||value.length>max)fail();}
export function animaticV1NodeId(ref){if(typeof ref!=='string'||!/^node\/[A-Za-z0-9_-]{1,180}$/.test(ref))fail('故事板须引用真实node_ref');return ref.slice(5);}
export function animaticV1Cells(value){if(!Array.isArray(value)||!value.length||value.length>9)fail();for(const cell of value){fields(cell,['x','y','w','h']);Em(cell,1,1);}return clone(value);}
export function prepareAnimaticV1(data,title='动态分镜'){
 fields(data,['version','locale','title','sheets']);if(data.version!==undefined&&data.version!==1||data.locale!==undefined&&!copy[data.locale]||!Array.isArray(data.sheets)||!data.sheets.length||data.sheets.length>32)fail();
 const out=clone(data);out.version=1;out.title=data.title??title;text(out.title,200);const sheets=new Set(),shots=new Set();
 for(const sheet of out.sheets){fields(sheet,['sheet_id','label','sheet_node_ref','image_url','cells','shots']);text(sheet.sheet_id,120);if(sheets.has(sheet.sheet_id)||!Array.isArray(sheet.shots)||!sheet.shots.length||sheet.shots.length>9)fail();sheets.add(sheet.sheet_id);text(sheet.label,200,true);animaticV1NodeId(sheet.sheet_node_ref);
  if(typeof sheet.image_url!=='string'||sheet.image_url.length>256000||!/^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(sheet.image_url))fail('故事板预览须由宿主从本地像素派生');sheet.cells=animaticV1Cells(sheet.cells);const cells=new Set();
  for(const shot of sheet.shots){fields(shot,['shot_code','cell','duration','move','transition','size','script_text']);text(shot.shot_code,120);text(shot.script_text,600);text(shot.size,40,true);if(shots.has(shot.shot_code)||!Number.isInteger(shot.cell)||!sheet.cells[shot.cell]||cells.has(shot.cell)||!Number.isFinite(shot.duration)||shot.duration<=0||shot.duration>60||!['static','push_in','pull_out','pan_left','pan_right','tilt_up','tilt_down'].includes(shot.move)||shot.transition!==undefined&&!['cut','dissolve'].includes(shot.transition))fail();shots.add(shot.shot_code);cells.add(shot.cell);}
 }
 if(shots.size>96||new TextEncoder().encode(JSON.stringify(out)).length>animaticV1Limits.dataBytes)fail('历史动态分镜输入过大');return out;
}
export function animaticV1Timeline(data){const d=prepareAnimaticV1(data);let start=0;return d.sheets.flatMap((sheet,sheetIndex)=>[...sheet.shots].sort((a,b)=>a.cell-b.cell).map(shot=>{const row={sheet,shot,sheetIndex,start};start+=shot.duration;return row;}));}
export function initialAnimaticV1State(data){return {selected_shot_code:animaticV1Timeline(data)[0].shot.shot_code,view:'player',playing:false};}
export function validateAnimaticV1State(state,data){fields(state,['selected_shot_code','view','playing']);if(!['player','overview'].includes(state.view)||state.playing!==false||!animaticV1Timeline(data).some(n=>n.shot.shot_code===state.selected_shot_code))fail('历史动态分镜保存状态无效');return clone(state);}
export function animaticV1ConfirmProtocol(data){const d=prepareAnimaticV1(data),timeline=animaticV1Timeline(d);return z_(d.sheets.length,timeline.length,timeline.reduce((sum,n)=>sum+n.shot.duration,0));}
export function animaticV1Message(action,data,locale=data.locale??'en-US'){
 const d=prepareAnimaticV1(data),t=copy[locale]??copy['en-US'];if(action==='reject')return t.rejectSummary+' — '+x_();if(action!=='confirm')fail();const timeline=animaticV1Timeline(d),summary=Object.entries({sheets:d.sheets.length,shots:timeline.length,duration:timeline.reduce((sum,n)=>sum+n.shot.duration,0).toFixed(1)}).reduce((s,[k,v])=>s.split('{'+k+'}').join(String(v)),t.confirmSummary);return summary+' — '+animaticV1ConfirmProtocol(d);
}
export async function resolveAnimaticV1Reply(message,data,state){
 text(message,4000);const d=prepareAnimaticV1(data),saved=validateAnimaticV1State(state??initialAnimaticV1State(d),d);let action;
 for(const locale of Object.keys(copy)){for(const candidate of ['confirm','reject'])if(message===animaticV1Message(candidate,d,locale))action=candidate;}
 if(!action)fail('历史动态分镜消息须精确匹配官方摘要与AN1 v1协议');const result={action,version:1,sheets:d.sheets,state:saved,timeline:animaticV1Timeline(d).map(n=>n.shot)},digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(result))))].map(n=>n.toString(16).padStart(2,'0')).join('');return {kind:action==='confirm'?'confirmed':'rejected',text:message,metadata:{handoffId:'animatic_v1_'+digest},result};
}
export {Em as animaticV1CellRect,Hs as animaticV1CameraRect};
