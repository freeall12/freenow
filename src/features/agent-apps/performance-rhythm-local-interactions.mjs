// Keep the packaged page as evidence. Only this exact v3 source can receive the
// local persistence/confirmation race fix; visual and score rules stay official.
export const performanceRhythmSourceSha256 = '9ead0d0bb847a55c3598ba90626b3fba85f9d2acbc773a447b12ee57d8994ae3';

export async function localizePerformanceRhythmInteractions(html, name, version) {
  if (name !== 'performance-rhythm') return html;
  if (version !== 'v3') throw Error('unsupported local performance-rhythm version');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== performanceRhythmSourceSha256) throw Error('performance-rhythm reference integrity mismatch');
  const changes = [
    // Tabbing focuses a marker without selecting it in the official page.
    // Delete must act on the focused marker, rather than a different selection.
    ['e.preventDefault(),bp();return}else return;e.preventDefault(),O=br(O,n,i,a,',
      'e.preventDefault(),Qt("point",n),bp();return}else return;e.preventDefault(),Qt("point",n),O=br(O,n,i,a,'],
    ['o.preventDefault(),Bs();return}if(o.key!=="ArrowLeft"&&o.key!=="ArrowRight")return;o.preventDefault();const t=o.shiftKey?500:100,',
      'o.preventDefault(),Qt("beat",e.id),Bs();return}if(o.key!=="ArrowLeft"&&o.key!=="ArrowRight")return;o.preventDefault();Qt("beat",e.id);const t=o.shiftKey?500:100,'],
    // A slow save receives only the newest pending snapshot, not an unbounded
    // list of pointer moves. A failed save remains retryable by the next flush.
    ['const kb=db(async e=>{await Xt.request({method:"tapnow/setWidgetState",params:{state:e}},ne({}))});',
      'let rhythmSaveLatest=null,rhythmSaveWork=null,rhythmSavedFingerprint=null;function kb(e){rhythmSaveLatest=e;if(!rhythmSaveWork)rhythmSaveWork=Promise.resolve().then(async()=>{while(rhythmSaveLatest){const state=rhythmSaveLatest,fingerprint=JSON.stringify(state);rhythmSaveLatest=null;if(fingerprint===rhythmSavedFingerprint)continue;try{await Xt.request({method:"tapnow/setWidgetState",params:{state}},ne({}));rhythmSavedFingerprint=fingerprint}catch(error){rhythmSaveLatest=rhythmSaveLatest??state;throw error}}}).then(()=>{rhythmSaveWork=null;if(rhythmSaveLatest)return kb(rhythmSaveLatest)},error=>{rhythmSaveWork=null;throw error});return rhythmSaveWork}'],
    ['async function fp(){if(!Ms)try{await kb(bb())}catch{}}',
      'async function fp(){if(Ms)return false;try{await kb(bb());return true}catch{Ki();return false}}async function rhythmFlush(){if(De!==null){clearTimeout(De);De=null}return fp()}function rhythmSavedNotice(){const notes={"zh-CN":"已保存，请再次点击确认。","en-US":"Saved. Click confirm again.","ja-JP":"保存しました。もう一度確定してください。","ko-KR":"저장했습니다. 다시 확인을 눌러 주세요.","fr-FR":"Enregistré. Cliquez à nouveau sur confirmer."};if(ye)ye.textContent=notes[document.documentElement.lang]??notes["en-US"]}'],
    // Lock before the first await. Confirmation uses one saved snapshot, and a
    // failed save never reaches ui/message. Inert blocks native edits while the
    // storage transaction is pending without replacing any official controls.
    ['async function Zb(){De!==null&&(clearTimeout(De),De=null),await fp();try{const e=hb((w==null?void 0:w.duration_ms)??0,O,G,Me);await gp(`${Rb()} — ${e}`,Ki)}catch{Ki()}}',
      'async function Zb(){if(dt||Ms)return;if(De!==null){clearTimeout(De);De=null}const previousInert=Ls.inert,focused=document.activeElement;dt=true;Ls.inert=true;X();const state=bb(),summary=Rb(),milliseconds=(w==null?void 0:w.duration_ms)??0;try{await kb(state);if(JSON.stringify(bb())!==JSON.stringify(state))throw Error("performance rhythm changed during confirmation");if(navigator.userActivation&&!navigator.userActivation.isActive){rhythmSavedNotice();return}const e=hb(milliseconds,state.curve,state.beats,state.review_requested);await Xt.sendMessage({role:"user",content:[{type:"text",text:`${summary} — ${e}`}]});if(ye)ye.textContent=""}catch{Ki()}finally{Ls.inert=previousInert;dt=false;X();if(!previousInert&&focused?.isConnected&&Ls.contains(focused))focused.focus?.({preventScroll:true})}}'],
    // Debounce remains for continuous input. Completed gestures flush the last
    // edit, including pointercancel, field blur, and keyboard nudges.
    ['Ab();</script>',
      'for(const event of ["pointerup","pointercancel","click","change","focusout"])Ls.addEventListener(event,()=>{if(!dt)void rhythmFlush()});Ls.addEventListener("keyup",event=>{if(!dt&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Delete","Backspace"].includes(event.key))void rhythmFlush()});Ab();</script>'],
  ];
  for (const [original, local] of changes) {
    if (html.split(original).length !== 2) throw Error('performance-rhythm local interaction contract integrity mismatch');
    html = html.replace(original, local);
  }
  return html;
}
