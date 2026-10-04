(() => {
const session=new URLSearchParams(location.search).get('session')||'default',prefs=new Map();
Object.defineProperty(window,'localStorage',{value:{getItem:key=>prefs.get(key)??null,setItem:(key,value)=>prefs.set(key,String(value)),removeItem:key=>prefs.delete(key)}});
window.CANVAS_DB_NAME='tapnow-qa-alignment-'+session;window.TEMPLATE_DB_NAME='tapnow-qa-alignment-templates-'+session;window.LOCAL_ASSETS_DB_NAME='tapnow-qa-alignment-assets-'+session;
localStorage.setItem('tapnow-canvas-view-v1',JSON.stringify({x:-33700.16,y:1480.325,scale:.65}));
window.ALIGNMENT_DOC={version:1,initialized:true,width:600,height:600,canvas:{version:'6.7.0',background:'#ffffff',objects:[{id:'snap-target',name:'琥珀色对齐对象',type:'Rect',version:'6.7.0',originX:'center',originY:'center',left:180.125,top:180.375,width:120,height:80,fill:'#d99732',strokeWidth:0,scaleX:1,scaleY:1,angle:0,flipX:false,flipY:false,opacity:1,visible:true}]}};
window.CANVAS_DATA={referenceWidth:1026,referenceHeight:997,edges:[],nodes:[{id:'alignment-editor',type:'image',tool:'image-editor',title:'图片吸附隔离验收',x:52000.25,y:-1800.5,width:600,height:600,editorDoc:structuredClone(window.ALIGNMENT_DOC)}]};
})();
