try{
 await window.LibraryRoundtripQAStorage.ready;
 for(const descriptor of JSON.parse(document.querySelector('#generation-readiness-production-scripts').textContent)){
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');if(descriptor.type)script.type=descriptor.type;
   if(descriptor.src){script.src=descriptor.src;script.async=false;script.onload=resolve;script.onerror=()=>reject(Error('Production script failed: '+descriptor.src));}
   else script.textContent=descriptor.text;
   document.body.append(script);if(!descriptor.src)resolve();
  });
 }
 const opener=document.createElement('button');opener.textContent='QA：打开生成 API 配置';opener.style.cssText='position:fixed;right:12px;top:12px;z-index:70;background:#333;color:#eee;padding:8px';
 opener.onclick=()=>window.GenerationAPI.configure();document.body.append(opener);
 if(window.GenerationConfigurationQA.profile==='angle'){
  const angle=document.createElement('button');angle.textContent='QA：打开多角度';angle.style.cssText=opener.style.cssText+';top:52px';
  angle.onclick=async()=>{const module=await import('../../../../image-angle-ui.mjs');module.open('angle-source');};document.body.append(angle);
  const receipts=document.createElement('p');receipts.id='generation-qa-receipts';receipts.textContent='合同任务提交次数：0';receipts.style.cssText='position:fixed;right:12px;top:88px;color:#aaa';document.body.append(receipts);
 }
}catch(error){const output=document.createElement('pre');output.textContent='QA bootstrap: '+error.message;document.body.append(output);}
