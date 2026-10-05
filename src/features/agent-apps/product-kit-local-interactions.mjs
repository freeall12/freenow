import {localLifecycleScript} from './local-lifecycle.mjs';

// Both inputs are pinned after the existing thumbnail transport correction.
// Product fields, editing choices, fixed palette order and PK1 remain official.
export const productKitReferenceSha256 = '758d09b3f06e99a6b4e47a782d33ef90b9f12935c140b8bdfe88ca41f76e2535';
export const productKitTransportSha256 = '7434c9a09d30ca1b6f1b6c84aca80f4d82eaa8bc590e93a0a60bfc164f44131b';
export const productKitDemoSha256 = 'bf378d28fe79d46390b75b4f5ab0d1cbc2bbf7ab46f360154c6de234c5d02234';
const copy = {
  'zh-CN': {failed: 'Product Kit 保存或交接失败，请重试。', saved: 'Kit 已保存，请再次点击确认按钮继续。'},
  'en-US': {failed: 'Product Kit save or handoff failed. Please retry.', saved: 'Kit saved. Click the confirmation button again to continue.'},
  'ja-JP': {failed: 'Product Kit の保存または送信に失敗しました。再試行してください。', saved: 'Kit を保存しました。確認ボタンをもう一度押してください。'},
  'ko-KR': {failed: 'Product Kit 저장 또는 전송에 실패했습니다. 다시 시도하세요.', saved: 'Kit를 저장했습니다. 확인 버튼을 다시 누르세요.'},
  'fr-FR': {failed: 'Échec de la sauvegarde ou de l’envoi du Product Kit. Réessayez.', saved: 'Kit sauvegardé. Cliquez à nouveau sur le bouton de confirmation.'},
};
const originalPersistence = 'const O_=T_(async e=>{await Ut.request({method:"tapnow/setWidgetState",params:{state:e}},Y({}))});function Im(){Ln&&clearTimeout(Ln),Ln=setTimeout(()=>{Ln=null,D_()},220)}async function D_(){if(!(os||!K))try{await O_(Nn(K))}catch{}}';
const persistence = 'const productKitLocalCopy=' + JSON.stringify(copy) + String.raw`;
let productKitSaveWork=null,productKitPendingSave=null,productKitSavedFingerprint=null,productKitEpoch=0,productKitDisposed=false;
function productKitStatus(error,notice){if(productKitDisposed)return;const text=productKitLocalCopy[L?.locale]??productKitLocalCopy["en-US"];Ie=error?text.failed:notice?text[notice]:z.ready;productKitPaintStatus()}
function productKitPaintStatus(){const status=wm.querySelector(".status");if(status)status.textContent=Ie;else if(K?.view==="recall"&&!de){const status=S("p","status product-kit-local-status",Ie);status.setAttribute("role","status");wm.querySelector(".recall")?.appendChild(status)}}
function O_(value){const state=Nn(value);productKitPendingSave={state,fingerprint:JSON.stringify(state),epoch:productKitEpoch};return productKitDrainQueue()}
function productKitDrainQueue(){if(productKitSaveWork)return productKitSaveWork;const work=Promise.resolve().then(async()=>{while(productKitPendingSave){const task=productKitPendingSave;productKitPendingSave=null;if(productKitDisposed||task.epoch!==productKitEpoch)throw Error("Product Kit 页面已关闭或来源已变化");if(os||task.fingerprint===productKitSavedFingerprint)continue;await Ut.request({method:"tapnow/setWidgetState",params:{state:task.state}},Y({}));if(productKitDisposed||task.epoch!==productKitEpoch)throw Error("Product Kit 页面已关闭或来源已变化");productKitSavedFingerprint=task.fingerprint}});const completed=work.then(()=>{if(productKitSaveWork===completed)productKitSaveWork=null;if(productKitPendingSave)return productKitDrainQueue()},error=>{if(productKitSaveWork===completed)productKitSaveWork=null;throw error});productKitSaveWork=completed;return completed}
function Im(){if(Ln!==null)clearTimeout(Ln);Ln=setTimeout(()=>{Ln=null;void D_()},220)}
async function D_(){if(!K||productKitDisposed)return false;const epoch=productKitEpoch;try{await O_(Nn(K));if(epoch===productKitEpoch)productKitStatus(null);return true}catch(error){if(epoch===productKitEpoch)productKitStatus(error);return false}}
function productKitFlush(){if(Ln!==null){clearTimeout(Ln);Ln=null}return D_()}
function productKitFocusEditor(){wm.querySelector(".editor button:not(:disabled)")?.focus({preventScroll:true})}
function productKitFocusView(){wm.querySelector(K?.view==="recall"?".recall .primary":".header .ghost")?.focus({preventScroll:true})}
`;
const originalSubmit = 'async function Tm(){if(!(zt||!L||!K)){if(os){Ie=z.ready,ze();return}zt=!0,Ie=z.sending,ze();try{await Ut.sendMessage({role:"user",content:[{type:"text",text:`${q_()}\n${z_(L,K)}`}]}),Ie=z.ready}catch{Ie=z.sendFailed}finally{zt=!1,ze()}}}';
const submit = String.raw`async function Tm(){if(zt||!L||!K||productKitDisposed)return;if(os){Ie=z.ready;ze();return}if(Ln!==null){clearTimeout(Ln);Ln=null}const state=Nn(K),epoch=productKitEpoch,message=q_()+"\n"+z_(L,state),wasInert=wm.inert===true;zt=true;wm.inert=true;Ie=z.sending;ze();try{await O_(state);if(productKitDisposed||epoch!==productKitEpoch||JSON.stringify(K)!==JSON.stringify(state))throw Error("Product Kit 保存期间来源或状态已变化");if(globalThis.navigator?.userActivation?.isActive===false){productKitStatus(null,"saved");return}await Ut.sendMessage({role:"user",content:[{type:"text",text:message}]});Ie=z.ready}catch(error){if(epoch===productKitEpoch)productKitStatus(error)}finally{wm.inert=wasInert;zt=false;if(!productKitDisposed&&epoch===productKitEpoch){ze();if(K.view==="recall"&&Ie!==z.ready)productKitPaintStatus()}}}`;
const closing = String.raw`;
wm.addEventListener("click",()=>{if(!zt&&!productKitDisposed&&Ln!==null)void productKitFlush()});
window.addEventListener("blur",()=>{if(!zt&&!productKitDisposed&&Ln!==null)void productKitFlush()});
window.addEventListener("pagehide",()=>{productKitDisposed=true;productKitPendingSave=null;if(Ln!==null){clearTimeout(Ln);Ln=null}});
`;

export async function localizeProductKitInteractions(html, name, version) {
  if (name !== 'product-kit') return html;
  if (version !== 'v1') throw Error('unsupported local product-kit interaction version');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (![productKitTransportSha256, productKitDemoSha256].includes(digest)) throw Error('product-kit interaction reference integrity mismatch');
  const changes = [
    [originalPersistence, persistence],
    [originalSubmit, submit],
    ['()=>{We=!We,ze()}', '()=>{We=!We,ze(),wm.querySelector(".hypothesis-toggle")?.focus({preventScroll:true})}'],
    ['()=>{N_(i=>{i.confirmed_ids.push(o.id)},z.ready),fi(K).length===0&&(We=!1)}', '()=>{N_(i=>{i.confirmed_ids.push(o.id)},z.ready),fi(K).length===0&&(We=!1),wm.querySelector(".hypothesis-row .amber-button,.footer .primary")?.focus({preventScroll:true})}'],
    ['function Mn(e,n=""){de&&(e(de),Ie=n,ze())}', 'function Mn(e,n=""){if(!de)return;const controls=[...wm.querySelectorAll(".editor button")],index=controls.indexOf(document.activeElement);e(de);Ie=n;ze();if(index>=0)wm.querySelectorAll(".editor button")[index]?.focus({preventScroll:true})}'],
    ['()=>{de=Nn(K),de.view="full",Ie="",ze()}', '()=>{de=Nn(K),de.view="full",Ie="",ze(),productKitFocusEditor()}'],
    ['()=>{de=Nn(K),de.view="full",ze()}', '()=>{de=Nn(K),de.view="full",ze(),productKitFocusEditor()}'],
    ['()=>{de=null,Ie=z.ready,ze()}', '()=>{de=null,Ie=z.ready,ze(),productKitFocusView()}'],
    ['()=>{K=Nn(de),de=null,Ie=z.ready,ze(),Im()}', '()=>{K=Nn(de),de=null,Ie=z.ready,ze(),Im(),productKitFocusView()}'],
    ['function zm(e,n){const r=k_(e);', 'function zm(e,n){productKitEpoch++;productKitPendingSave=null;productKitSavedFingerprint=null;if(Ln!==null){clearTimeout(Ln);Ln=null}const r=k_(e);'],
    ['as();F_();</script>', closing + localLifecycleScript({root: 'wm', flush: 'productKitFlush()', busy: 'zt'}) + 'as();F_();</script>'],
  ];
  for (const [original, local] of changes) {
    if (html.split(original).length !== 2) throw Error('product-kit local interaction contract integrity mismatch');
    html = html.replace(original, local);
  }
  return html;
}
