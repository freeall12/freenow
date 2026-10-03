'use strict';
const MAX_SUBTITLE_BYTES=32*1024;
// Subtitles are explicit provider metadata attached to one real audio output.
// Never infer them from ordinary text outputs, prompts or request node IDs.
function checkedAudioSubtitle(output,{code='invalid_outputs'}={}){
 const invalid=()=>Object.assign(Error('音频字幕元数据无效'),{code});
 if(output.subtitle===undefined)return undefined;
 const subtitle=output.subtitle;
 if(output.type!=='audio'||!subtitle||Object.getPrototypeOf(subtitle)!==Object.prototype||Object.keys(subtitle).length!==1||!Object.hasOwn(subtitle,'text')||typeof subtitle.text!=='string'||Buffer.byteLength(subtitle.text,'utf8')>MAX_SUBTITLE_BYTES||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(subtitle.text)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(subtitle.text))throw invalid();
 if(!subtitle.text.trim())return undefined;
 return {text:subtitle.text};
}
module.exports={checkedAudioSubtitle,MAX_SUBTITLE_BYTES};
