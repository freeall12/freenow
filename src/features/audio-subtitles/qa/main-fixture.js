(()=>{
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-audio-subtitle-main:'+encodeURIComponent(session)+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 preferences.set('tapnow-canvas-view-v1',JSON.stringify({x:140,y:250,scale:.7}));preferences.set('tapnow-playlist-intro-hidden','true');
 const node={id:'qa-subtitle-origin',type:'audio',title:'Seed 字幕合同 QA · 空音频来源',x:40,y:140,width:300,height:300,audioConfig:{virtualModel:'seed-audio-1-0',scene:'Text-to-Speech',model:'doubao-seed-audio-1-0',prompt:'QA 合同请求文本；不作为字幕来源',params:{format:'wav',sample_rate:24000,speech_rate:0,pitch_rate:0,loudness_rate:0,enable_subtitle:true},references:[]}};
 const seed={referenceWidth:1400,referenceHeight:900,nodes:[node],edges:[]};Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
 const state=window.AudioSubtitleMainFixture={namespace:prefix,sourceId:node.id,fetches:[],externalAttempts:[],providerCalls:0,subtitleText:' 合同回放字幕：本机真实 WAV\nSecond line · 显式返回文本 ',lastJobId:null,holdNext:false,held:null,failNextSave:false};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){state.externalAttempts.push(url.hostname);throw Error('字幕合同 QA 禁止外部请求');}
  if(['/api/generation/config','/api/agent/config'].includes(url.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
  if(url.pathname==='/api'||url.pathname.startsWith('/api/'))throw Error('字幕合同 QA 禁止模型或其他 API');
  state.fetches.push(url.protocol==='blob:'?'blob:local-byte-read':url.pathname);return nativeFetch(input,options);
 };
})();
