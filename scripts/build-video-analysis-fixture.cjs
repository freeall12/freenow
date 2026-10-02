'use strict';
// Real local media pipeline with explicitly fixed model text. No provider calls.
const fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {createOpenAINativeProvider}=require('../server/generation-openai.cjs');
async function main(){
 const root=path.resolve(__dirname,'..'),source=path.join(root,'qa/trim-scenes.mp4'),bytes=await fs.readFile(source);
 const metadata=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_entries','stream=width,height:format=duration','-of','json',source],{encoding:'utf8'})),{width,height}=metadata.streams.find(s=>s.width),duration=Number(metadata.format.duration),calls=[];
 const modelMap={'video.analyze':{kind:'video.analyze',model:'fixed-description-no-remote-model'}};
 const provider=createOpenAINativeProvider({modelMap,client:{responses:{create:async(body,options)=>{
  const scene=JSON.parse(body.input[0].content[0].text);calls.push({scene,frames:body.input[0].content.filter(x=>x.type==='input_image').length,maxRetries:options.maxRetries});
  return {status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({title:'本地裁切分镜 '+scene.sceneNumber,description:'固定描述用于协议验收；视频、海报和时间区间由实际 FFmpeg 处理产生，未调用真实模型。'})}]}]};
 }}}});
 const request={kind:'video.analyze',nodeId:'analysis-source',prompt:'',inputs:[{type:'video',url:'data:video/mp4;base64,'+bytes.toString('base64'),width,height,duration,clip:null}],parameters:{operation:'film_scene_breakdown',nodePosition:{x:40.25,y:240.75},width,height,duration}};
 const result=await provider.submit(request);if(result.status!=='succeeded')throw Error('Actual media pipeline failed');
 const report={label:'真实FFmpeg分镜，模型描述为固定夹具',source:'/qa/trim-scenes.mp4',metadata:{width,height,duration},calls,outputs:result.outputs};
 await fs.writeFile(path.join(root,'qa/video-analysis-native-result.json'),JSON.stringify(report));
 console.log(JSON.stringify({scenes:result.outputs.map(o=>({sourceRange:o.sourceRange,duration:o.duration,width:o.width,height:o.height})),modelCalls:calls.length,actualRemoteCalls:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
