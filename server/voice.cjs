'use strict';
const {protectModelClient}=require('./outbound-client.cjs');
const extensions={'audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/flac':'flac'};
const error=(message,code)=>Object.assign(new Error(message),{code});
async function transcribeRequest(req,{client,model,toFile,signal,maxBytes=25*1024*1024}){
 if(!client||!model)throw error('请在本地服务配置 OPENAI_API_KEY 和 OPENAI_TRANSCRIPTION_MODEL。录音未发送至模型服务。','configuration_required');
 client=protectModelClient(client);
 const mime=String(req.headers['content-type']||'').split(';')[0].trim();if(!extensions[mime])throw error('不支持的录音格式','invalid_audio');
 if(Number(req.headers['content-length'])>maxBytes)throw error('录音超过25MB','too_large');
 const parts=[];let size=0;for await(const chunk of req){if(signal?.aborted)throw signal.reason;size+=chunk.length;if(size>maxBytes)throw error('录音超过25MB','too_large');parts.push(chunk);}if(!size)throw error('录音为空','empty');
 const file=await toFile(Buffer.concat(parts),'voice.'+extensions[mime],{type:mime});
 const result=await client.audio.transcriptions.create({file,model,response_format:'json'},{signal});if(typeof result?.text!=='string'||!result.text.trim())throw error('未识别到有效文字，请重试','empty_text');return {text:result.text};
}
module.exports={transcribeRequest};
