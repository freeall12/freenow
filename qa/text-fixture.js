(() => {
 const params=new URLSearchParams(location.search),session=params.get('session')||'default',storage=window.localStorage,prefix='qa-text:'+session+':';
 Object.defineProperty(window,'localStorage',{value:{getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,String(value)),removeItem:key=>storage.removeItem(prefix+key)}});
 window.CANVAS_DB_NAME='tapnow-qa-text-'+session;window.TEMPLATE_DB_NAME='tapnow-qa-text-templates-'+session;window.LOCAL_ASSETS_DB_NAME='tapnow-qa-text-assets-'+session;
 window.EDITOR_DATA={nodes:{},lenses:{}};window.SIDEBAR_DATA={template:[],history:[]};window.VERSION_DATA={};
 window.CANVAS_DATA={referenceWidth:889,referenceHeight:1011,edges:[{id:'sg',source:'s',target:'g'}],nodes:[
  {id:'s',type:'text',textMode:'pure',title:'文本验收',content:'# 分镜说明\n\n**角色**与*环境*。\n\n- 第一镜\n- 第二镜\n\n[说明链接](https://example.test)\n\n![不加载](https://example.test/private.png)\n\n<script>window.injected=true</script>',x:52000.25,y:-2000.5,width:300,height:200,color:'#253027'},
  {id:'g',type:'text',textMode:'generate',title:'文本生成',content:'',generation:{prompt:'写一段分镜',model:'gemini-3.1-flash-lite',count:1},x:52400.25,y:-2000.5,width:300,height:200},
  {id:'i',type:'image',title:'参考图片',image:'/assets/tap-logo.webp',x:52000.25,y:-1600.5,width:300,height:200}
 ]};
 window.addEventListener('load',()=>window.CanvasApp?.setView({x:-51880.25,y:2120.5,scale:1}));
})();
