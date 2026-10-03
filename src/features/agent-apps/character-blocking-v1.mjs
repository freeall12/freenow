// Preserved character-blocking@v1.596deb3b.html: D_/N_/Ss/K_/L_/n$/r$.
// V1 is a positional board. Its actual schema has no facing or portrait fields.
export const characterBlockingV1Uri='ui://tapnow/character-blocking@v1';
export const characterBlockingV1Policy=Object.freeze({allowExpanded:false,autoExpandOnReady:false});
export const characterBlockingV1Locales=Object.freeze(['zh-CN','en-US','ja-JP','ko-KR','fr-FR']);
export const characterBlockingV1Ratios=Object.freeze(['16:9','9:16','1:1','4:3','3:4']);
export const characterBlockingV1Limits=Object.freeze({inputChars:12000,replyChars:16384});
const targets=['image','video'],object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=()=>{throw Error('历史人物站位 v1 数据无效或与已保存位置不一致');};
function fields(value,keys){if(!object(value)||Object.keys(value).some(key=>!keys.includes(key)))fail();}
function text(value,max,required=false){if(typeof value!=='string'||value.length>max||required&&!value.trim())fail();try{encodeURIComponent(value);}catch{fail();}return value;}
function coordinate(value){if(!Number.isInteger(value)||value<0||value>1000)fail();return value;}
export function prepareCharacterBlockingV1(data,title='人物站位'){
 fields(data,['locale','target','aspect_ratio','scene','characters']);text(title,200,true);
 if(data.locale!==undefined&&!characterBlockingV1Locales.includes(data.locale)||!targets.includes(data.target)||!characterBlockingV1Ratios.includes(data.aspect_ratio)||!Array.isArray(data.characters)||data.characters.length<1||data.characters.length>12)fail();
 const seen=new Set(),characters=data.characters.map(character=>{
  fields(character,['id','name','role','x','y']);if(typeof character.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(character.id)||seen.has(character.id))fail();seen.add(character.id);
  return {id:character.id,name:text(character.name,200,true),...(character.role!==undefined?{role:text(character.role,1000)}:{}),x:coordinate(character.x),y:coordinate(character.y)};
 });
 const result={version:1,locale:data.locale||'zh-CN',title,target:data.target,aspect_ratio:data.aspect_ratio,scene:text(data.scene,4000),characters,summary:title};
 if(JSON.stringify(result).length>characterBlockingV1Limits.inputChars)throw Error('历史人物站位输入过长，请缩短描述');return result;
}
function prepared(data){fields(data,['version','locale','title','target','aspect_ratio','scene','characters','summary']);if(data.version!==1)fail();text(data.summary,200);return prepareCharacterBlockingV1({locale:data.locale,target:data.target,aspect_ratio:data.aspect_ratio,scene:data.scene,characters:data.characters},data.title);}
export function validateCharacterBlockingV1State(value,data){
 const source=prepared(data),ids=source.characters.map(character=>character.id);fields(value,['positions','selected_id','snap','target','aspect_ratio']);fields(value.positions,ids);
 if(Object.keys(value.positions).length!==ids.length||!ids.includes(value.selected_id)||typeof value.snap!=='boolean'||!targets.includes(value.target)||!characterBlockingV1Ratios.includes(value.aspect_ratio))fail();
 const positions={};for(const id of ids){fields(value.positions[id],['x','y']);positions[id]={x:coordinate(value.positions[id].x),y:coordinate(value.positions[id].y)};}
 return {positions,selected_id:value.selected_id,snap:value.snap,target:value.target,aspect_ratio:value.aspect_ratio};
}
export function initialCharacterBlockingV1State(data){const source=prepared(data);return validateCharacterBlockingV1State({positions:Object.fromEntries(source.characters.map(character=>[character.id,{x:character.x,y:character.y}])),selected_id:source.characters[0].id,snap:false,target:source.target,aspect_ratio:source.aspect_ratio},source);}
export function characterBlockingV1Token(data,state){const source=prepared(data),saved=validateCharacterBlockingV1State(state,source);return `CB1 v=1;target=${saved.target};ratio=${saved.aspect_ratio};pos=${source.characters.map(character=>`${character.id}~${saved.positions[character.id].x}~${saved.positions[character.id].y}`).join(',')}`;}
const copy=Object.freeze({
 'zh-CN':{summary:'确认人物走位：{items}；目标 {target}，画幅 {ratio}',revise:'这版人物走位还要调整，我们回对话继续修改。',joiner:'、',image:'图片',video:'视频',horizontal:['左','中','右'],depth:['后景','中景','前景']},
 'en-US':{summary:'Confirm character blocking: {items}; target {target}, ratio {ratio}',revise:'I want to adjust this character blocking further in chat.',joiner:', ',image:'Image',video:'Video',horizontal:['left','center','right'],depth:['background','midground','foreground']},
 'ja-JP':{summary:'人物配置を確認：{items}；対象 {target}、比率 {ratio}',revise:'この人物配置をチャットでさらに調整します。',joiner:'、',image:'画像',video:'動画',horizontal:['左','中央','右'],depth:['背景','中景','前景']},
 'ko-KR':{summary:'인물 배치 확인: {items}; 대상 {target}, 화면비 {ratio}',revise:'이 인물 배치를 채팅에서 더 조정할게요.',joiner:', ',image:'이미지',video:'영상',horizontal:['왼쪽','가운데','오른쪽'],depth:['배경','중경','전경']},
 'fr-FR':{summary:'Placement confirmé : {items} ; cible {target}, format {ratio}',revise:'Je veux encore ajuster ce placement dans le chat.',joiner:', ',image:'Image',video:'Vidéo',horizontal:['gauche','centre','droite'],depth:['arrière-plan','plan moyen','premier plan']},
});
export function characterBlockingV1Confirmation(data,state){
 const source=prepared(data),saved=validateCharacterBlockingV1State(state,source),strings=copy[source.locale],region=value=>value<=333?0:value<=666?1:2;
 const items=source.characters.map(character=>{const position=saved.positions[character.id];return `${character.name}（${strings.horizontal[region(position.x)]} · ${strings.depth[region(position.y)]}）`;}).join(strings.joiner);
 const summary=Object.entries({items,target:strings[saved.target],ratio:saved.aspect_ratio}).reduce((value,[key,item])=>value.split(`{${key}}`).join(String(item)),strings.summary);return summary+' — '+characterBlockingV1Token(source,saved);
}
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function resolveCharacterBlockingV1Reply(message,data,savedState){
 text(message,characterBlockingV1Limits.replyChars,true);const source=prepared(data);
 if(message===copy[source.locale].revise)return {kind:'revise',text:message,metadata:{}};
 const state=validateCharacterBlockingV1State(savedState,source);if(message!==characterBlockingV1Confirmation(source,state))fail();
 const result={version:1,title:source.title,scene:source.scene,target:state.target,aspect_ratio:state.aspect_ratio,characters:source.characters.map(character=>({...character,...state.positions[character.id]}))};
 const prompt=message+'\n\n已核对历史人物站位 v1 应用实际保存的位置。X=0左、1000右；Y=0后景、1000镜头侧，均为画面千分比。此版本只确认人物位置，没有头像或面向数据，不得补称已确认朝向或参考照片。请把实际人物位置、景深和画幅整理为生成提示词，并沿现有普通队列与生成API处理用户确认的目标；不得声称已经生成媒体、提交任务或扩大工具权限。\n'+JSON.stringify(result);
 if(prompt.length>characterBlockingV1Limits.replyChars)throw Error('历史人物站位交接过长');
 return {kind:'confirmed',text:prompt,metadata:{handoffId:'blocking1_'+await hash(JSON.stringify(result))},result};
}
