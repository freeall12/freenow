/* Scene setup mutations shared by UI and delayed generation results. */
(function(root){
  'use strict';
  const copy=value=>structuredClone(value);
  function normalize(data){
    data.setups??=[{id:'example',name:'示例状态',objects:copy(data.objects),keyframes:copy(data.keyframes||[]),duration:data.duration??3}];
    data.activeSetup??='example';
    data.baseline??={objects:[],keyframes:[]};
    return data;
  }
  function sync(data){
    normalize(data);
    if(data.activeSetup==='baseline'){
      const previous=data.baseline.objects,next=data.objects;
      for(const setup of data.setups){
        setup.objects=setup.objects.filter(o=>!previous.some(p=>p.id===o.id)||next.some(p=>p.id===o.id));
        for(const object of next){
          const old=previous.find(p=>p.id===object.id),current=setup.objects.find(p=>p.id===object.id);
          if(!current)setup.objects.push(copy(object));
          else for(const key of Object.keys(object))if(!old||JSON.stringify(current[key])===JSON.stringify(old[key]))current[key]=copy(object[key]);
        }
      }
      data.baseline={objects:copy(next),keyframes:copy(data.keyframes),duration:data.duration??3};
    }else{
      const setup=data.setups.find(s=>s.id===data.activeSetup);
      if(!setup)throw Error('当前片场状态不存在');
      setup.objects=copy(data.objects);setup.keyframes=copy(data.keyframes);setup.duration=data.duration??3;
    }
    return data;
  }
  function applyModels(data,job){
    data=sync(normalize(copy(data)));
    const setupId=job.request.parameters?.setupId||data.activeSetup;
    const target=setupId==='baseline'?data.baseline:data.setups.find(s=>s.id===setupId);
    if(!target)throw Error('生成时指定的片场状态已删除；模型仍保留在画布中');
    const position=job.request.parameters?.position||[0,data.ground.y,0];
    if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('模型放置坐标无效');
    const objects=job.outputs.filter(o=>o.type==='model').map((output,index)=>{
      const sourceUrl=output.url||output.sourceUrl;
      if(typeof sourceUrl!=='string'||!(/^(https?:|blob:|asset:)/.test(sourceUrl)))throw Error('模型地址无效');
      return {id:`generated-${job.id}-${index}`,kind:'model',name:output.title||job.request.prompt?.slice(0,40)||'3D 模型',sourceUrl,position:copy(position),rotation:[0,0,0],scale:[1,1,1],generationJobId:job.id};
    });
    if(!objects.length)throw Error('任务没有返回 3D 模型');
    const insert=list=>{for(const object of objects)if(!list.some(o=>o.id===object.id))list.push(copy(object));};
    insert(target.objects);
    if(setupId==='baseline')for(const setup of data.setups)insert(setup.objects);
    if(data.activeSetup===setupId||setupId==='baseline')insert(data.objects);
    return {data,objectIds:objects.map(o=>o.id),setupId};
  }
  root.StudioState={normalize,sync,applyModels};
  if(typeof module!=='undefined')module.exports=root.StudioState;
})(typeof window!=='undefined'?window:globalThis);
