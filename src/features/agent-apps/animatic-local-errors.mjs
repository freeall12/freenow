// The captured official HTML stays byte-identical. This hash-bound local
// derivative preserves a known pre-dispatch configuration failure instead of
// describing it as an uncertain remote submission.
export async function localizeAnimaticErrors(html,name,version){
 if(name!=='animatic')return html;
 if(version!=='v2')throw Error('unsupported local animatic version');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(html)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!=='bc00a3a525a598e8266cb9ac8576250e7e47ee2ba31d18ae5a7ae331cbc5ba28')throw Error('animatic reference integrity mismatch');
 const descriptions={'zh-CN':'尚未配置图片生成服务，请连接API后重试。任务尚未派发。','en-US':'Image generation is not configured. Connect the API and retry. No task was dispatched.','ja-JP':'画像生成サービスが未設定です。APIを接続して再試行してください。タスクは送信されていません。','ko-KR':'이미지 생성 서비스가 설정되지 않았습니다. API를 연결한 후 다시 시도하세요. 작업은 전송되지 않았습니다.','fr-FR':'La génération d’images n’est pas configurée. Connectez l’API puis réessayez. Aucune tâche n’a été envoyée.'};
 const changes=[
  ['catch{F={...F,[o]:{...n,status:"failed",error:"submit_failed"}}}', 'catch(z){F={...F,[o]:{...n,status:"failed",error:z?.data?.code==="configuration_required"||z?.code==="configuration_required"?"configuration_required":"submit_failed"}}}'],
  ['const t=r.error==="submit_failed"?S.submitRetry:S.variantFailed','const t=r.error==="configuration_required"?S.configurationRequired:r.error==="submit_failed"?S.submitRetry:S.variantFailed'],
  ['function ic(e){S=oo[e??""]??oo["en-US"],document.documentElement.lang=e||"en-US"}', 'const amLocalConfiguration='+JSON.stringify(descriptions)+';function ic(e){S={...(oo[e??""]??oo["en-US"]),configurationRequired:amLocalConfiguration[e]??amLocalConfiguration["en-US"]},document.documentElement.lang=e||"en-US"}'],
  ['Generate 9 options · {price} credits','Generate 9 options · provider pricing'],
  ['生成 9 个选项 · {price} 积分','生成 9 个选项 · 费用由供应商决定'],
 ];
 for(const [original,local]of changes){if(html.split(original).length!==2)throw Error('animatic local error contract integrity mismatch');html=html.replace(original,local);}
 return html;
}
