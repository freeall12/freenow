import {localLifecycleScript} from './local-lifecycle.mjs';

// The original installed bytes remain evidence. Only persistence and local
// lifecycle are derived; positions, facing math, portraits and CB3 stay official.
export const characterBlockingReferenceSha256 = 'f1fd0e23de67bf00f60ccf333b7d5b57262a01726a37adeef28c800d51a8815b';
const copy = {
  'zh-CN': {failed: '站位保存或交接失败，请重试。', saved: '站位已保存，请再次点击「确认人物走位」。', sent: '人物走位已交给 Agent，请继续对话。'},
  'en-US': {failed: 'Blocking save or handoff failed. Please retry.', saved: 'Blocking saved. Click Confirm blocking again.', sent: 'Character blocking was sent to the Agent. Continue in chat.'},
  'ja-JP': {failed: '配置の保存または送信に失敗しました。再試行してください。', saved: '配置を保存しました。もう一度確認ボタンを押してください。', sent: '人物配置を Agent に送信しました。チャットで続けてください。'},
  'ko-KR': {failed: '배치 저장 또는 전송에 실패했습니다. 다시 시도하세요.', saved: '배치를 저장했습니다. 확인 버튼을 다시 누르세요.', sent: '인물 배치를 Agent에 보냈습니다. 채팅에서 계속하세요.'},
  'fr-FR': {failed: 'Échec de la sauvegarde ou de l’envoi du placement. Réessayez.', saved: 'Placement sauvegardé. Cliquez à nouveau sur Confirmer.', sent: 'Le placement a été envoyé à l’Agent. Continuez dans le chat.'},
};
const persistence = 'const blockingLocalCopy=' + JSON.stringify(copy) + String.raw`;
let blockingSaveWork=Promise.resolve(),blockingSavedFingerprint=null,blockingEpoch=0,blockingDisposed=false;
function blockingStatus(error,notice){if(!se||blockingDisposed)return;const text=blockingLocalCopy[ae?.locale]??blockingLocalCopy["en-US"];se.textContent=error?text.failed+(typeof error.message==="string"?" "+error.message:""):notice?text[notice]:""}
function lb(value){const state=JSON.parse(JSON.stringify(value)),fingerprint=JSON.stringify(state),epoch=blockingEpoch;const work=blockingSaveWork.catch(()=>{}).then(async()=>{if(blockingDisposed||epoch!==blockingEpoch)throw Error("人物站位页面已关闭或来源已变化");if(fingerprint===blockingSavedFingerprint)return;await Vt.request({method:"tapnow/setWidgetState",params:{state}},Q({}));if(blockingDisposed||epoch!==blockingEpoch)throw Error("人物站位页面已关闭或来源已变化");blockingSavedFingerprint=fingerprint});blockingSaveWork=work;return work}
async function Ym(){try{await lb(db());blockingStatus(null);return true}catch(error){blockingStatus(error);return false}}
function blockingFlush(){if(je!==null){clearTimeout(je);je=null}return Ym()}
`;
const confirmation = String.raw`async function Sb(){if(Mt||blockingDisposed)return;if(je!==null){clearTimeout(je);je=null}const focused=document.activeElement,wasInert=Wm.inert===true;Mt=true;Wm.inert=true;Oe();const state=db(),summary=kb(),ids=Xm(),epoch=blockingEpoch;try{await lb(state);if(blockingDisposed||epoch!==blockingEpoch||JSON.stringify(db())!==JSON.stringify(state))throw Error("人物站位保存期间来源或状态已变化");if(globalThis.navigator?.userActivation?.isActive===false){blockingStatus(null,"saved");return}const token=rb(ids,state.positions,state.facings,state.target,state.aspect_ratio);await Vt.sendMessage({role:"user",content:[{type:"text",text:summary+" — "+token}]});blockingStatus(null,"sent")}catch(error){blockingStatus(error)}finally{Wm.inert=wasInert;Mt=false;Oe();if(!wasInert&&!blockingDisposed&&focused?.isConnected&&Wm.contains(focused))focused.focus?.({preventScroll:true})}}`;
const gestures = String.raw`;
for(const type of ["pointerup","pointercancel","change","focusout","click"])Wm.addEventListener(type,()=>{if(!Mt&&!blockingDisposed)void blockingFlush()});
Wm.addEventListener("keyup",event=>{if(!Mt&&!blockingDisposed&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))void blockingFlush()});
window.addEventListener("pagehide",()=>{blockingDisposed=true;if(je!==null){clearTimeout(je);je=null}});
`;

export async function localizeCharacterBlockingInteractions(html, name, version) {
  if (name !== 'character-blocking') return html;
  if (version !== 'v3') throw Error('unsupported local character-blocking version');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== characterBlockingReferenceSha256) throw Error('character-blocking reference integrity mismatch');
  const changes = [
    ['const lb=X_(async e=>{await Vt.request({method:"tapnow/setWidgetState",params:{state:e}},Q({}))});', persistence],
    ['async function Ym(){try{await lb(db())}catch{}}', ''],
    ['async function Sb(){je!==null&&(clearTimeout(je),je=null),await Ym();try{const e=rb(Xm(),G,V,at,Re);await Qm(`${kb()} — ${e}`,Ei)}catch{Ei()}}', confirmation],
    ['Vt.ontoolresult=e=>{const n=', 'Vt.ontoolresult=e=>{blockingEpoch++;blockingSavedFingerprint=null;const n='],
    // Preserve the last coordinates/facing on pointercancel as the official page
    // does; flush the same state instead of inventing a drag rollback.
    ['wb();</script>', gestures + localLifecycleScript({root: 'Wm', flush: 'blockingFlush()', busy: 'Mt'}) + 'wb();</script>'],
  ];
  for (const [original, local] of changes) {
    if (html.split(original).length !== 2) throw Error('character-blocking local interaction contract integrity mismatch');
    html = html.replace(original, local);
  }
  return html;
}
