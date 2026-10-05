import {localLifecycleScript} from './local-lifecycle.mjs';
// Preserve captured evidence. Only this pinned official renderer receives the
// local save/confirmation repair; appState and NS1 remain the official contract.
export const storyRoomReferenceSha256 = 'dae7d235df8887af866f8b1984b75075c651f1b4d8f79775a0470a4b89f569a0';

const statusCopy = {
  'zh-CN': {failed: '结构保存或交接失败，请重试。', sent: '已将回复交给 Agent，请继续对话。', saved: '结构已保存，请再次点击「确认结构」或「先跳过」。'},
  'en-US': {failed: 'Structure saving or handoff failed. Please retry.', sent: 'Your reply was sent to the Agent. Continue in chat.', saved: 'Structure saved. Click Confirm structure or Skip again.'},
  'ja-JP': {failed: '構成の保存または送信に失敗しました。再試行してください。', sent: '返信を Agent に送信しました。チャットで続けてください。', saved: '構成を保存しました。もう一度「構成を確定」または「スキップ」を押してください。'},
  'ko-KR': {failed: '구조 저장 또는 전송에 실패했습니다. 다시 시도하세요.', sent: '응답을 Agent에 보냈습니다. 채팅에서 계속하세요.', saved: '구조를 저장했습니다. 구조 확인 또는 건너뛰기를 다시 누르세요.'},
  'fr-FR': {failed: 'Échec de la sauvegarde ou de l’envoi. Réessayez.', sent: 'Votre réponse a été envoyée à l’Agent. Continuez dans le chat.', saved: 'Structure sauvegardée. Cliquez à nouveau sur Valider la structure ou Passer.'},
};

const saveOriginal = 'function Te(){An!==null&&clearTimeout(An),An=setTimeout(()=>{An=null,P_()},400)}async function P_(){try{await Tt.request({method:"tapnow/setWidgetState",params:{state:{cols:w.cols,news:w.news,nseq:w.nseq,dels:w.dels,filter:w.filter,collapsed:w.collapsed,stripOpen:w.stripOpen}}},Q({}))}catch{}}';
const saveLocal = 'let localStorySaveWork=Promise.resolve(),localStorySavedFingerprint=null;const localStoryCopy=' + JSON.stringify(statusCopy) + ';function localStoryStatus(error,sent=false,needsAction=false){let node=j_.querySelector(".local-story-status");if(!node){node=document.createElement("p");node.className="local-story-status";node.setAttribute("role","status");node.style.cssText="margin:12px 16px;white-space:pre-wrap;color:var(--color-text-error)";j_.appendChild(node)}const copy=localStoryCopy[ge?.locale]??localStoryCopy["en-US"];node.textContent=error?copy.failed+(typeof error.message==="string"?" "+error.message:""):needsAction?copy.saved:sent?copy.sent:"";node.style.color=error?"var(--color-text-error)":"var(--color-text-success)";node.hidden=!node.textContent}function Te(){An!==null&&clearTimeout(An),An=setTimeout(()=>{An=null;P_().catch(localStoryStatus)},400)}function P_(){const state=JSON.parse(JSON.stringify({cols:w.cols,news:w.news,nseq:w.nseq,dels:w.dels,filter:w.filter,collapsed:w.collapsed,stripOpen:w.stripOpen}));const fingerprint=JSON.stringify(state),work=localStorySaveWork.catch(()=>{}).then(async()=>{if(localStorySavedFingerprint===fingerprint)return;await Tt.request({method:"tapnow/setWidgetState",params:{state}},Q({}));localStorySavedFingerprint=fingerprint}).then(()=>localStoryStatus(null));localStorySaveWork=work;return work}';
const sendOriginal = 'let ui=!1;async function Cs(e){if(!ui){ui=!0;try{await Tt.sendMessage({role:"user",content:[{type:"text",text:e}]})}catch{}finally{ui=!1}}}';
const sendLocal = 'let ui=!1;async function Cs(e){if(!ui){ui=!0;const active=document.activeElement,wasInert=j_.inert===true,button=active?.tagName==="BUTTON"?active:null,wasDisabled=button?.disabled;j_.inert=true;if(button)button.disabled=true;try{An!==null&&(clearTimeout(An),An=null);await P_();if(globalThis.navigator?.userActivation?.isActive===false){localStoryStatus(null,false,true);return}await Tt.sendMessage({role:"user",content:[{type:"text",text:e}]});localStoryStatus(null,true)}catch(error){localStoryStatus(error)}finally{j_.inert=wasInert;if(button)button.disabled=wasDisabled;ui=!1;if(active?.isConnected&&typeof active.focus==="function")active.focus({preventScroll:true})}}}';

export async function localizeStoryRoomInteractions(html, name, version) {
  if (name !== 'story-room') return html;
  if (version !== 'v1') throw Error('unsupported local story-room version');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  const digest = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== storyRoomReferenceSha256) throw Error('story-room reference integrity mismatch');
  const changes = [
    [saveOriginal, saveLocal],
    [sendOriginal, sendLocal],
    ['拖拽、增删只在本地生效，点「确认结构」才会写回画布。', '拖拽、增删会保存在本地，点「确认结构」后交给 Agent 继续整理。'],
    // km trims before truncation. Restoring a saved 24-character name must not
    // silently remove a legitimate trailing truncation space from the NS1 token.
    ['const y=km($.name);if(!y||!r.includes($.act))return null;t[m]={name:y,act:$.act}', 'const cleaned=km($.name),y=$.name.length===24&&$.name.endsWith(" ")&&cleaned===$.name.slice(0,-1)?$.name:cleaned;if(!y||!r.includes($.act))return null;t[m]={name:y,act:$.act}'],
    // Window message delivery may preserve registration order at its target.
    // Install before connect() starts the SDK transport, as Rhythm already does.
    ['R_();</script>',localLifecycleScript({root:'j_',flush:'(An!==null&&(clearTimeout(An),An=null),P_())',busy:'ui'})+'R_();</script>'],
  ];
  for (const [original, local] of changes) {
    if (html.split(original).length !== 2) throw Error('story-room local interaction contract integrity mismatch');
    html = html.replace(original, local);
  }
  return html;
}
