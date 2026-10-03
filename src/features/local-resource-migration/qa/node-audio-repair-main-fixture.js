(()=>{
 'use strict';
 const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-node-audio-repair-main:'+encodeURIComponent(session)+':',preferences=new Map(),nativeFetch=window.fetch.bind(window);
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value)),removeItem:key=>preferences.delete(key)}});
 window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
 preferences.set('tapnow-canvas-view-v1',JSON.stringify({x:180,y:130,scale:.85}));
 preferences.set('tapnow-playlist-intro-hidden','true');
 const old='https://files.tapnow.media/qa-main-unknown-audio.wav?token=synthetic-qa-only',nodes=['qa-audio-selected','qa-audio-other'].map((id,index)=>({id,type:'audio',title:index?'QA 其他旧音频 · 保留待导入':'QA 选择旧音频 · 人工替换',x:40+index*340,y:120,width:280,height:230,audio:old,audioMode:'upload',audioDuration:123,durationMs:123000,audioConfig:{virtualModel:'mureka-v8',scene:'Music',model:'mureka-8',prompt:'保留QA下一次生成参数',params:{lyric_mode:false,lyrics:''},references:[]},sourceJournal:{source:old,signature:'synthetic-keep'},provenance:{kind:'generation-result',mediaSource:old,model:'QA旧模型'}}));
 const seed={referenceWidth:1400,referenceHeight:900,nodes,edges:[{id:'qa-audio-edge',source:nodes[0].id,target:nodes[1].id}]};
 Object.defineProperty(window,'CANVAS_DATA',{get:()=>seed,set:()=>{}});
 const state=window.NodeAudioRepairMainFixture={namespace:prefix,selectedId:nodes[0].id,otherId:nodes[1].id,fetches:[],externalAttempts:[],originalRef:old};
 const Context=window.AudioContext||window.webkitAudioContext,nativeDecode=Context?.prototype.decodeAudioData;
 if(nativeDecode)Context.prototype.decodeAudioData=function(...args){
  const hold=state.holdNextDecode;state.holdNextDecode=false;const decoded=nativeDecode.apply(this,args);
  if(!hold)return decoded;
  return decoded.then(buffer=>new Promise(resolve=>{state.heldDecode={duration:buffer.duration,release:()=>{state.heldDecode=null;resolve(buffer);window.dispatchEvent(new Event('qa:audio-upload'));}};window.dispatchEvent(new Event('qa:audio-upload'));}));
 };
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(url.origin!==location.origin&&!['blob:','data:'].includes(url.protocol)){state.externalAttempts.push(url.hostname);throw Error('独立主壳修复 QA 禁止外部请求');}
  if(['/api/generation/config','/api/agent/config'].includes(url.pathname))return Response.json({configured:false,capabilities:{kinds:[]}});
  if(url.pathname==='/api'||url.pathname.startsWith('/api/'))throw Error('独立主壳修复 QA 禁止模型或其他 API');
  state.fetches.push(url.protocol==='blob:'?'blob:local-byte-read':url.pathname);
  return nativeFetch(input,options);
 };
})();
