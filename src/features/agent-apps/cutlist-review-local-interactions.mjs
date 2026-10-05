import {localLifecycleScript} from './local-lifecycle.mjs';

// Pin the installed page. Keep its fixed shot order, source-time trim math,
// native preview controls and CR1; repair only save, send and local closure.
export const cutlistReviewReferenceSha256 = 'a3b103653d65e220bde4ce6503a499d4a659a79dccf525dff0f59b1bf95771a8';
const copy = {
  'zh-CN': {failed: '裁切计划保存或交接失败，请重试。', saved: '计划已保存，请再次点击刚才的按钮继续。', sent: '消息已交给 Agent，请继续对话。'},
  'en-US': {failed: 'Cut plan save or handoff failed. Please retry.', saved: 'Plan saved. Click the same button again to continue.', sent: 'Your message was sent to the Agent. Continue in chat.'},
  'ja-JP': {failed: '編集プランの保存または送信に失敗しました。再試行してください。', saved: 'プランを保存しました。同じボタンをもう一度押してください。', sent: 'メッセージを Agent に送信しました。チャットで続けてください。'},
  'ko-KR': {failed: '편집 계획 저장 또는 전송에 실패했습니다. 다시 시도하세요.', saved: '계획을 저장했습니다. 같은 버튼을 다시 눌러 계속하세요.', sent: '메시지를 Agent에 보냈습니다. 채팅에서 계속하세요.'},
  'fr-FR': {failed: 'Échec de la sauvegarde ou de l’envoi du montage. Réessayez.', saved: 'Plan sauvegardé. Cliquez à nouveau sur le même bouton.', sent: 'Votre message a été envoyé à l’Agent. Continuez dans le chat.'},
};
const originalPersistence = 'let qn=null;function Qn(){qn!==null&&clearTimeout(qn),qn=setTimeout(()=>{qn=null,wm()},400)}async function wm(){const e={};for(const n of He()){const r=$e[n.id];e[n.id]={keep:r.keep,in_ms:r.inMs,out_ms:r.outMs}}try{await Pt.request({method:"tapnow/setWidgetState",params:{state:{shots:e}}},B({}))}catch{}}';
const persistence = 'const cutlistLocalCopy=' + JSON.stringify(copy) + String.raw`;
let qn=null,cutlistSaveWork=Promise.resolve(),cutlistSavedFingerprint=null,cutlistEpoch=0,cutlistDisposed=false;
function cutlistStatus(error,notice){if(!ct||cutlistDisposed)return;const text=cutlistLocalCopy[ie.locale]??cutlistLocalCopy["en-US"];ct.textContent=error?text.failed+(typeof error.message==="string"?" "+error.message:""):notice?text[notice]:""}
function cutlistState(){const shots={};for(const shot of He()){const value=$e[shot.id];shots[shot.id]={keep:value.keep,in_ms:value.inMs,out_ms:value.outMs}}return{shots}}
function cutlistRows(state){return He().map(shot=>({id:shot.id,keep:state.shots[shot.id].keep,inMs:state.shots[shot.id].in_ms,outMs:state.shots[shot.id].out_ms}))}
function cutlistSave(value){const state=JSON.parse(JSON.stringify(value)),fingerprint=JSON.stringify(state),epoch=cutlistEpoch;const work=cutlistSaveWork.catch(()=>{}).then(async()=>{if(cutlistDisposed||epoch!==cutlistEpoch)throw Error("拼装审阅页面已关闭或来源已变化");if(fingerprint===cutlistSavedFingerprint)return;await Pt.request({method:"tapnow/setWidgetState",params:{state}},B({}));if(cutlistDisposed||epoch!==cutlistEpoch)throw Error("拼装审阅页面已关闭或来源已变化");cutlistSavedFingerprint=fingerprint});cutlistSaveWork=work;return work}
function Qn(){if(qn!==null)clearTimeout(qn);qn=setTimeout(()=>{qn=null;void wm()},400)}
async function wm(){try{await cutlistSave(cutlistState());cutlistStatus(null);return true}catch(error){cutlistStatus(error);return false}}
function cutlistFlush(){if(qn!==null){clearTimeout(qn);qn=null}return wm()}
async function cutlistSubmit(revise=false){if(Be||cutlistDisposed||!revise&&vi(Sm())!==null)return;const focused=document.activeElement,wasInert=b_.inert===true;Be=true;b_.inert=true;if(qn!==null){clearTimeout(qn);qn=null}if(revise)Cs();Oe();const state=cutlistState(),rows=cutlistRows(state),epoch=cutlistEpoch,values={k:rows.filter(row=>row.keep).length,t:rows.length,dur:we(us(rows)),target:ie.target_duration_s??0};const message=revise?F.reviseMsg:(typeof ie.target_duration_s==="number"?Ke(F.confirmTpl,values):Ke(F.confirmNoTargetTpl,values))+" — "+__(rows);try{await cutlistSave(state);if(cutlistDisposed||epoch!==cutlistEpoch||JSON.stringify(cutlistState())!==JSON.stringify(state))throw Error("拼装审阅保存期间来源或计划已变化");if(globalThis.navigator?.userActivation?.isActive===false){cutlistStatus(null,"saved");return}await Pt.sendMessage({role:"user",content:[{type:"text",text:message}]});cutlistStatus(null,"sent")}catch(error){cutlistStatus(error)}finally{b_.inert=wasInert;Be=false;Oe();if(!wasInert&&!cutlistDisposed&&focused?.isConnected&&b_.contains(focused))focused.focus?.({preventScroll:true})}}
`;
const closing = String.raw`;
b_.addEventListener("click",()=>{if(!Be&&!cutlistDisposed&&qn!==null)void cutlistFlush()});
window.addEventListener("pagehide",()=>{cutlistDisposed=true;if(qn!==null){clearTimeout(qn);qn=null}});
`;

export async function localizeCutlistReviewInteractions(html, name, version) {
  if (name !== 'cutlist-review') return html;
  if (version !== 'v1') throw Error('unsupported local cutlist-review version');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== cutlistReviewReferenceSha256) throw Error('cutlist-review reference integrity mismatch');
  const changes = [
    [originalPersistence, persistence],
    ['async function z_(){const e=Sm();if(Be||vi(e)!==null)return;ct&&(ct.textContent="");const r={k:e.filter(t=>t.keep).length,t:e.length,dur:we(us(e)),target:ie.target_duration_s??0},o=typeof ie.target_duration_s=="number"?Ke(F.confirmTpl,r):Ke(F.confirmNoTargetTpl,r);await Im(`${o} — ${__(e)}`,zm)}', 'async function z_(){await cutlistSubmit(false)}'],
    ['()=>{Cs(),wm(),Im(F.reviseMsg,zm),Oe()}', '()=>{void cutlistSubmit(true)}'],
    ['Pt.ontoolresult=e=>{ie=', 'Pt.ontoolresult=e=>{cutlistEpoch++;cutlistSavedFingerprint=null;ie='],
    ['x_();</script>', closing + localLifecycleScript({root: 'b_', flush: 'cutlistFlush()', busy: 'Be'}) + 'x_();</script>'],
  ];
  for (const [original, local] of changes) {
    if (html.split(original).length !== 2) throw Error('cutlist-review local interaction contract integrity mismatch');
    html = html.replace(original, local);
  }
  return html;
}
