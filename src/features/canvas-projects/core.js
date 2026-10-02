(() => {
  'use strict';
  const DEFAULT_ID='canvas',DEFAULT_TITLE='未命名画布';
  // A document owns its identity for its entire lifetime. No shared active-project key.
  const projectId=new URL(location.href).searchParams.get('project')||DEFAULT_ID;
  const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id);
  let metadata={id:projectId,title:projectId===DEFAULT_ID?DEFAULT_TITLE:'未命名画布',createdAt:null,updatedAt:null};
  let dirty=false,navigating=false;
  const guards=new Set();
  function title(value){const result=String(value||'').trim();if(!result)throw Error('请输入画布名称');if(result.length>120)throw Error('画布名称最多120个字符');return result;}
  function applyTitle(){const button=document.querySelector('#project-title');if(button)button.textContent=metadata.title;document.title=metadata.title+' · 画布复刻';}
  const api={
    defaultId:DEFAULT_ID,
    id:()=>projectId,
    current:()=>({...metadata}),
    isDefault:()=>projectId===DEFAULT_ID,
    storageKey:key=>projectId===DEFAULT_ID?key:key+':project:'+projectId,
    namespace:base=>projectId===DEFAULT_ID?base:base+':project:'+projectId,
    validateTitle:title,
    url(id){if(!validId(id))throw Error('画布项目标识无效');const url=new URL(location.href);if(id===DEFAULT_ID)url.searchParams.delete('project');else url.searchParams.set('project',id);return url.href;},
    hydrate(saved){if(saved?.project){if(saved.project.id&&saved.project.id!==projectId)throw Error('画布数据与当前项目不匹配');metadata={...metadata,...saved.project,id:projectId,title:title(saved.project.title||metadata.title)};}applyTitle();},
    snapshot(graph,view,history=[],future=[]){
      if(!validId(projectId))throw Error('画布项目标识无效');
      const now=Date.now();metadata={...metadata,createdAt:metadata.createdAt||now,updatedAt:now};
      return {...graph,project:{...metadata},view:{...view},history:history.slice(-60),future:future.slice(-60)};
    },
    setTitle(value){metadata={...metadata,title:title(value)};applyTitle();},
    markDirty(value=true){dirty=value;},
    registerNavigationGuard(guard){guards.add(guard);return()=>guards.delete(guard);},
    async assertCanNavigate(){for(const guard of guards){const reason=await guard();if(reason)throw Error(typeof reason==='string'?reason:'当前操作尚未完成，请稍后切换画布');}},
    async prepareNavigation(){await api.assertCanNavigate();if(!window.CanvasApp?.prepareProjectNavigation)throw Error('画布仍在加载，请稍后重试');await window.CanvasApp.prepareProjectNavigation();await api.assertCanNavigate();},
    async switchTo(id){
      if(id===projectId)return;
      if(navigating)throw Error('正在切换画布，请稍候');
      if(!validId(id))throw Error('画布项目标识无效');
      navigating=true;
      try{
        await api.assertCanNavigate();
        const saved=await window.CanvasStore.load(id);if(id!==DEFAULT_ID&&!saved)throw Error('未找到此本地画布');
        // Flush after the read so edits made while loading the destination are retained.
        await api.prepareNavigation();location.assign(api.url(id));
      }finally{navigating=false;}
    },
    async create(value){
      const name=title(value);await api.prepareNavigation();
      const id=crypto.randomUUID(),now=Date.now();
      const state={version:1,nodes:[],edges:[],view:{x:0,y:0,scale:1},history:[],future:[],project:{id,title:name,createdAt:now,updatedAt:now}};
      await window.CanvasStore.save(state,id);return {...state.project};
    },
    async rename(value){const name=title(value);if(!window.CanvasApp?.renameProject)throw Error('画布仍在加载，请稍后重试');return window.CanvasApp.renameProject(name);}
  };
  window.CanvasProjects=api;
  api.registerNavigationGuard(()=>{
    if(window.CanvasImageEditor?.current)return '请先保存并关闭图片编辑器，再切换画布';
    if(window.StudioAPI?.active)return '请先关闭片场并完成保存，再切换画布';
    if(window.GenerationAPI?.getJobs().some(job=>['queued','running','unknown'].includes(job.status)||job.applying))return '仍有生成任务运行或等待确认，请先完成或取消任务，再切换画布';
    return null;
  });
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  applyTitle();
})();
