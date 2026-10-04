(() => {
 const native={protocol:'openai-native',configured:true,missing:[],capabilities:{kinds:['text.generate','image.generate'],models:{'contract-image':{kind:'image.generate'},'contract-text':{kind:'text.generate'}}}};
 const gateway={protocol:'tasks-v1',configured:true,missing:[],capabilities:{kinds:[],verified:'local-contract-only'}};
 const routed={protocol:'routed',configured:true,missing:[],providers:{images:native,custom:gateway,video:{protocol:'ark-native',configured:false,missing:['ARK_API_KEY'],capabilities:{kinds:['video.generate'],models:{'contract-video':{kind:'video.generate'}}}}},routes:{'image.generate':'images','text.generate':'images','video.generate':'video','video.extend':'custom'}};
 const angle={protocol:'fal-native',configured:true,missing:[],capabilities:{kinds:['image.multiAngle'],models:{'image.multiAngle':{kind:'image.multiAngle'}},multiAngle:{semantics:'explicit-native-alternative',label:'Qwen 2511 Multiple Angles'}}};
 const profile=new URLSearchParams(location.search).get('profile')||'routed',profiles={routed,native,gateway,angle},metadata=profiles[profile];
 if(!metadata&&profile!=='offline')throw Error('Unknown configuration QA profile');
 const fetchOriginal=window.fetch.bind(window);
 if(profile==='angle')window.CANVAS_DATA={referenceWidth:889,referenceHeight:1011,nodes:[{id:'angle-source',type:'image',title:'本地多角度合同源图',image:'/src/features/video-history/qa/landscape.png',x:100.25,y:80.5,width:375,height:250}],edges:[]};
 const receipts=[];window.GenerationConfigurationQA={profile,receipts};
 // Public metadata fixtures only; no credentials, vendor requests or config writes.
 window.fetch=(url,options={})=>{
  const target=new URL(typeof url==='string'?url:url.url,location.href);
  if(target.origin===location.origin&&target.pathname==='/api/generation/config'){
   if(options.method&&options.method!=='GET')return Promise.reject(Error('QA configuration writes disabled'));
   return profile==='offline'?Promise.reject(Error('QA service unavailable')):Promise.resolve(new Response(JSON.stringify(metadata),{headers:{'Content-Type':'application/json'}}));
  }
  if(profile==='angle'&&target.origin===location.origin&&target.pathname==='/api/generation/tasks'&&options.method==='POST'){
   receipts.push(JSON.parse(options.body));document.querySelector('#generation-qa-receipts').textContent='合同任务提交次数：'+receipts.length;
   return Promise.resolve(new Response(JSON.stringify({id:'multi-angle-contract-'+receipts.length,status:'queued'}),{status:202,headers:{'Content-Type':'application/json'}}));
  }
  if(profile==='angle'&&target.origin===location.origin&&/^\/api\/generation\/tasks\/multi-angle-contract-\d+$/.test(target.pathname))return Promise.resolve(new Response(JSON.stringify({id:target.pathname.split('/').pop(),status:'succeeded',outputs:[{type:'image',url:new URL('/src/features/video-history/qa/portrait.png',location.href).href}]}),{headers:{'Content-Type':'application/json'}}));
  return fetchOriginal(url,options);
 };
})();
