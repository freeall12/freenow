// Unmodified character-blocking@v3.f1fd0e23.html: B_/W_/Ts/Ps/rb/kb/Sb.
export const characterBlockingUri = 'ui://tapnow/character-blocking@v3';
export const characterBlockingPolicy = Object.freeze({allowExpanded:false,autoExpandOnReady:false});
export const characterBlockingLocales = Object.freeze(['zh-CN','en-US','ja-JP','ko-KR','fr-FR']);
export const characterBlockingRatios = Object.freeze(['16:9','9:16','1:1','4:3','3:4']);
export const characterBlockingLimits = Object.freeze({portraitChars:20000,portraitBase64Chars:160000,inputChars:12000,replyChars:16384,sourceBytes:8*1024*1024,totalSourceBytes:16*1024*1024,timeoutMs:30000});
const modes=['image','video'],object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=()=>{throw Error('人物站位数据无效或与已保存站位不一致');};
function fields(v,keys){if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))fail();}
function text(v,max,required=false){if(typeof v!=='string'||v.length>max||required&&!v.trim())fail();try{encodeURIComponent(v);}catch{fail();}return v;}
function integer(v,max){if(!Number.isInteger(v)||v<0||v>max)fail();return v;}
function id(v){if(typeof v!=='string'||!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(v))fail();return v;}
export function characterBlockingPortrait(value){
  fields(value,['data_uri','source']);text(value.data_uri,characterBlockingLimits.portraitChars,true);
  if(value.source!=='image-crop'||value.data_uri.length<27||!/^data:image\/webp;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data_uri))fail();
  return {data_uri:value.data_uri,source:'image-crop'};
}
export function prepareCharacterBlocking(data,title='人物站位'){
  fields(data,['locale','target','aspect_ratio','scene','characters']);text(title,200,true);
  if(data.locale!==undefined&&!characterBlockingLocales.includes(data.locale)||!modes.includes(data.target)||!characterBlockingRatios.includes(data.aspect_ratio)||!Array.isArray(data.characters)||data.characters.length<1||data.characters.length>12)fail();
  let total=0;const seen=new Set(),characters=data.characters.map(c=>{
    fields(c,['id','name','role','x','y','facing','portrait']);id(c.id);if(seen.has(c.id))fail();seen.add(c.id);
    const result={id:c.id,name:text(c.name,200,true),x:integer(c.x,1000),y:integer(c.y,1000),facing:integer(c.facing===undefined?180:c.facing,359)};
    if(c.role!==undefined)result.role=text(c.role,1000);
    if(c.portrait!==undefined){result.portrait=characterBlockingPortrait(c.portrait);total+=result.portrait.data_uri.length-'data:image/webp;base64,'.length;}
    return result;
  });
  if(total>characterBlockingLimits.portraitBase64Chars)fail();
  const result={version:3,locale:data.locale||'zh-CN',title,target:data.target,aspect_ratio:data.aspect_ratio,scene:text(data.scene,4000),characters,summary:title};
  const plain={...result,characters:characters.map(({portrait,...c})=>c)};
  if(JSON.stringify(plain).length>characterBlockingLimits.inputChars)throw Error('人物站位输入过长，请缩短人物描述或场景');return result;
}
function prepared(data){fields(data,['version','locale','title','target','aspect_ratio','scene','characters','summary']);if(data.version!==3)fail();text(data.summary,200);return prepareCharacterBlocking({locale:data.locale,target:data.target,aspect_ratio:data.aspect_ratio,scene:data.scene,characters:data.characters},data.title);}
export function validateCharacterBlockingState(value,data){
  const source=prepared(data),ids=source.characters.map(c=>c.id);fields(value,['positions','facings','selected_id','snap','target','aspect_ratio']);fields(value.positions,ids);fields(value.facings,ids);
  if(Object.keys(value.positions).length!==ids.length||Object.keys(value.facings).length!==ids.length||!ids.includes(value.selected_id)||typeof value.snap!=='boolean'||!modes.includes(value.target)||!characterBlockingRatios.includes(value.aspect_ratio))fail();
  const positions={},facings={};for(const key of ids){fields(value.positions[key],['x','y']);positions[key]={x:integer(value.positions[key].x,1000),y:integer(value.positions[key].y,1000)};facings[key]=integer(value.facings[key],359);}
  return {positions,facings,selected_id:value.selected_id,snap:value.snap,target:value.target,aspect_ratio:value.aspect_ratio};
}
export function initialCharacterBlockingState(data){const source=prepared(data);return validateCharacterBlockingState({positions:Object.fromEntries(source.characters.map(c=>[c.id,{x:c.x,y:c.y}])),facings:Object.fromEntries(source.characters.map(c=>[c.id,c.facing])),selected_id:source.characters[0].id,snap:false,target:source.target,aspect_ratio:source.aspect_ratio},source);}
export function characterBlockingToken(data,state){const source=prepared(data),s=validateCharacterBlockingState(state,source);return `CB3 v=3;target=${s.target};ratio=${s.aspect_ratio};actors=${source.characters.map(c=>`${c.id}~${s.positions[c.id].x}~${s.positions[c.id].y}~${s.facings[c.id]}`).join(',')}`;}
const copy=Object.freeze({
 'zh-CN':{summary:'确认人物走位：{items}；目标 {target}，画幅 {ratio}',revise:'这版人物走位还要调整，我们回对话继续修改。',joiner:'、',image:'图片',video:'视频',horizontal:['左','中','右'],depth:['后景','中景','前景'],facing:['向后景','右后方','向右','右前方','向镜头','左前方','向左','左后方']},
 'en-US':{summary:'Confirm character blocking: {items}; target {target}, ratio {ratio}',revise:'I want to adjust this character blocking further in chat.',joiner:', ',image:'Image',video:'Video',horizontal:['left','center','right'],depth:['background','midground','foreground'],facing:['background','back right','right','front right','camera','front left','left','back left']},
 'ja-JP':{summary:'人物配置を確認：{items}；対象 {target}、比率 {ratio}',revise:'この人物配置をチャットでさらに調整します。',joiner:'、',image:'画像',video:'動画',horizontal:['左','中央','右'],depth:['背景','中景','前景'],facing:['背景向き','右奥','右向き','右手前','カメラ向き','左手前','左向き','左奥']},
 'ko-KR':{summary:'인물 배치 확인: {items}; 대상 {target}, 화면비 {ratio}',revise:'이 인물 배치를 채팅에서 더 조정할게요.',joiner:', ',image:'이미지',video:'영상',horizontal:['왼쪽','가운데','오른쪽'],depth:['배경','중경','전경'],facing:['배경 방향','오른쪽 뒤','오른쪽','오른쪽 앞','카메라 방향','왼쪽 앞','왼쪽','왼쪽 뒤']},
 'fr-FR':{summary:'Placement confirmé : {items} ; cible {target}, format {ratio}',revise:'Je veux encore ajuster ce placement dans le chat.',joiner:', ',image:'Image',video:'Vidéo',horizontal:['gauche','centre','droite'],depth:['arrière-plan','plan moyen','premier plan'],facing:['vers l’arrière-plan','arrière droite','droite','avant droite','vers la caméra','avant gauche','gauche','arrière gauche']},
});
export function characterBlockingConfirmation(data,state){const source=prepared(data),s=validateCharacterBlockingState(state,source),t=copy[source.locale],region=n=>n<=333?0:n<=666?1:2;
  const items=source.characters.map(c=>{const p=s.positions[c.id],f=s.facings[c.id];return `${c.name}（${t.horizontal[region(p.x)]} · ${t.depth[region(p.y)]}，${t.facing[Math.round(f/45)%8]} ${f}°）`;}).join(t.joiner);
  const summary=Object.entries({items,target:t[s.target],ratio:s.aspect_ratio}).reduce((v,[k,n])=>v.split(`{${k}}`).join(String(n)),t.summary);return `${summary} — ${characterBlockingToken(source,s)}`;
}
const hash=async bytes=>[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function resolveCharacterBlockingReply(message,data,savedState){
  text(message,characterBlockingLimits.replyChars,true);const source=prepared(data);
  if(message===copy[source.locale].revise)return {kind:'revise',text:message,metadata:{}};
  const state=validateCharacterBlockingState(savedState,source);if(message!==characterBlockingConfirmation(source,state))fail();
  const characters=await Promise.all(source.characters.map(async c=>{const {portrait,x,y,facing,...rest}=c;return {...rest,...state.positions[c.id],facing:state.facings[c.id],...(portrait?{portrait:{source:'image-crop',sha256:await hash(Uint8Array.from(atob(portrait.data_uri.split(',')[1]),c=>c.charCodeAt(0)))}}:{})};}));
  const result={version:3,title:source.title,scene:source.scene,target:state.target,aspect_ratio:state.aspect_ratio,characters};
  const prompt=`${message}\n\n已核对本应用提交保存的人物站位。坐标为画面宽高千分比：X=0左、1000右，Y=0后景、1000镜头侧；面向0°后景、90°右、180°镜头、270°左。请把实际人物位置、景深、朝向和画幅整理为生成提示词，并沿现有普通队列与生成API处理用户确认的目标；不得声称已经生成媒体、提交任务或扩大工具权限。人物参考仅来自宿主核验的本地图片。\n${JSON.stringify(result)}`;
  if(prompt.length>characterBlockingLimits.replyChars)throw Error('人物站位交接过长，请缩短人物描述或场景');
  return {kind:'confirmed',text:prompt,metadata:{handoffId:'blocking_'+await hash(new TextEncoder().encode(JSON.stringify(result)))},result};
}
