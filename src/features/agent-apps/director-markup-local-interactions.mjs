import {localLifecycleScript} from './local-lifecycle.mjs';

// Keep the packaged source intact. Selection, anchoring and DM1 remain official.
export const directorMarkupSourceSha256 = '4b53a29e33ef9c42a56045a678279e99f5f5aa5aad654cbb46fa1ef4bbd3850f';
export async function localizeDirectorMarkupInteractions(html, name, version) {
  if (name !== 'director-markup') return html;
  if (version !== 'v1') throw Error('unsupported local director-markup version');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== directorMarkupSourceSha256) throw Error('director-markup reference integrity mismatch');
  const changes = [
    ['r.onfocus=()=>{S&&(S={...S,activeAnnotationId:n}),se("outside-pointer")}',
      'r.onfocus=()=>{S&&(S={...S,activeAnnotationId:n},Qn()),se("outside-pointer")}'],
    ['async function Jm(){if(!S||Mm)return!0;const e=q_(S);return new TextEncoder().encode(JSON.stringify(e)).length>G_?(oe=x.stateTooLarge,ke(),!1):(pi=pi.then(async()=>{try{return await Nn.request({method:"tapnow/setWidgetState",params:{state:e}},B({})),!0}catch{return oe=x.saveFailed,ke(),!1}}),pi)}',
      'let directorSaveLatest=null,directorSaveWork=null,directorSavedFingerprint=null;function directorPersist(e){directorSaveLatest=e;if(!directorSaveWork)directorSaveWork=Promise.resolve().then(async()=>{while(directorSaveLatest){const state=directorSaveLatest,fingerprint=JSON.stringify(state);directorSaveLatest=null;if(fingerprint===directorSavedFingerprint)continue;try{await Nn.request({method:"tapnow/setWidgetState",params:{state}},B({}));directorSavedFingerprint=fingerprint}catch(error){directorSaveLatest=directorSaveLatest??state;throw error}}}).then(()=>{directorSaveWork=null;if(directorSaveLatest)return directorPersist(directorSaveLatest)},error=>{directorSaveWork=null;throw error});return directorSaveWork}async function Jm(){if(!S||Mm)return true;const state=q_(S);if(new TextEncoder().encode(JSON.stringify(state)).length>G_){oe=x.stateTooLarge;ke();return false}try{await directorPersist(state);if(oe===x.saveFailed)oe="";ke();return true}catch{oe=x.saveFailed;ke();return false}}async function directorFlush(){if(Ce!==null){clearTimeout(Ce);Ce=null}return Jm()}function directorSavedNotice(){const notices={"zh-CN":"已保存，请再次点击确认。","en-US":"Saved. Click confirm again.","ja-JP":"保存しました。もう一度確定してください。","ko-KR":"저장했습니다. 다시 확인을 눌러 주세요.","fr-FR":"Enregistré. Cliquez à nouveau sur confirmer."};return notices[document.documentElement.lang]??notices["en-US"]}'],
    ['Le=!0,se("outside-pointer"),gi(!0),oe="",ke();const r=',
      'const directorConfirmedState=JSON.stringify(q_(S)),directorFocused=document.activeElement;Le=!0,se("outside-pointer"),gi(!0),oe="",ke();const r='],
    ['!await Jm())return;await Nn.sendMessage',
      '!await Jm())return;if(JSON.stringify(q_(S))!==directorConfirmedState)throw Error("director markup changed during confirmation");if(navigator.userActivation&&!navigator.userActivation.isActive){oe=directorSavedNotice();return}await Nn.sendMessage'],
    ['finally{Le=!1,gi(!1),ke()}}function gi(e)',
      'finally{Le=!1,gi(!1),ke();if(directorFocused?.isConnected)directorFocused.focus?.({preventScroll:true})}}function gi(e)'],
    ['Mm?(S=Rm({version:1,locale:"zh-CN",title:"雨夜来客",',
      'document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!event.isComposing&&Te.mode!=="closed"){const editor=event.target?.closest?.(".dm-toolbar")?ne.querySelector(".dm-editor"):null;event.preventDefault();se("escape");editor?.focus?.({preventScroll:true})}});for(const event of ["change","focusout"])ne.addEventListener(event,()=>{if(!Le)void directorFlush()});'+localLifecycleScript({root:'ne',flush:'directorFlush()',busy:'Le'})+'Mm?(S=Rm({version:1,locale:"zh-CN",title:"雨夜来客",'],
  ];
  for (const [original, local] of changes) {
    if (html.split(original).length !== 2) throw Error('director-markup interaction target integrity mismatch');
    html = html.replace(original, local);
  }
  return html;
}
