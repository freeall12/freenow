try{
 await window.LibraryRoundtripQAStorage.ready;
 const scripts=JSON.parse(document.querySelector('#library-roundtrip-production-scripts').textContent);
 for(const descriptor of scripts){
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');if(descriptor.type)script.type=descriptor.type;
   if(descriptor.src){script.src=descriptor.src;script.async=false;script.onload=resolve;script.onerror=()=>reject(Error('生产脚本加载失败：'+descriptor.src));}
   else script.textContent=descriptor.text;
   document.body.append(script);if(!descriptor.src)resolve();
  });
 }
 await window.CanvasLibrary.ready();
 await import('./controls.mjs');
}catch(error){const output=document.createElement('pre');output.textContent='QA bootstrap失败：'+error.message;output.setAttribute('role','alert');document.body.append(output);console.error(error);}
