(() => {
const session=new URLSearchParams(location.search).get('session')||'default',prefs=new Map();
Object.defineProperty(window,'localStorage',{value:{getItem:key=>prefs.get(key)??null,setItem:(key,value)=>prefs.set(key,String(value)),removeItem:key=>prefs.delete(key)}});
window.CANVAS_DB_NAME='tapnow-qa-layer-menu-'+session;window.TEMPLATE_DB_NAME='tapnow-qa-layer-menu-templates-'+session;window.LOCAL_ASSETS_DB_NAME='tapnow-qa-layer-menu-assets-'+session;
localStorage.setItem('tapnow-canvas-view-v1',JSON.stringify({x:-33700.16,y:1480.325,scale:.65}));
const rect=(id,name,fill,left,top)=>({id,name,type:'Rect',version:'6.7.0',originX:'left',originY:'top',left,top,width:200,height:200,fill,strokeWidth:0,scaleX:1,scaleY:1,angle:0,flipX:false,flipY:false,opacity:1,visible:true});
window.LAYER_MENU_DOC={version:1,initialized:true,width:600,height:600,canvas:{version:'6.7.0',background:'#ffffff',objects:[rect('amber','琥珀底层','#d99732',150.125,150.375),rect('blue','蓝色中层','#326785',200.25,200.5),rect('green','绿色顶层','#4c926b',250.375,250.625)]}};
window.CANVAS_DATA={referenceWidth:1026,referenceHeight:997,edges:[],nodes:[{id:'layer-menu-editor',type:'image',tool:'image-editor',title:'图层菜单隔离验收',x:52000.25,y:-1800.5,width:600,height:600,editorDoc:structuredClone(window.LAYER_MENU_DOC)}]};
})();
