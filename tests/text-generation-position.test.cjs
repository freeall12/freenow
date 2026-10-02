const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./text-generation-render.test.cjs');
const source=fs.readFileSync(require.resolve('../text-generation-ui.js'),'utf8');
function positionFixture({count=5000,script=source,countReads=true}={}){
 const metrics={ids:0,canvasRects:0,panelHeights:0,anchorRects:0},target={id:'target',x:600.125,y:210.375,width:300.25,height:250.125},state={nodes:[...Array.from({length:count-1},(_,i)=>({id:'n'+i})),target],view:{x:7.125,y:9.375,scale:.7}};
 if(countReads)for(const item of state.nodes){const id=item.id;Object.defineProperty(item,'id',{get(){metrics.ids++;return id;}});}
 let panelHeight=180,rect={left:10,top:20,width:1280,right:1290},anchorRect={left:100,top:600};
 const panel={hidden:false,style:{},get offsetHeight(){metrics.panelHeights++;return panelHeight;}},pop={hidden:true,style:{},offsetWidth:220.5,offsetHeight:140.25},anchor={isConnected:true,getBoundingClientRect(){metrics.anchorRects++;return anchorRect;}};
 const context={panel,pop,active:'target',activeNode:target,popAnchor:anchor,app:{getState:()=>state},innerWidth:1300,innerHeight:900,document:{querySelector(){return {getBoundingClientRect(){metrics.canvasRects++;return rect;}};}}};vm.createContext(context);
 vm.runInContext(script.match(/  const node =[^\n]+/)[0]+script.slice(script.indexOf('  function position('),script.indexOf('  function closeMenu(')),context);
 return{state,target,panel,pop,anchor,context,metrics,position:options=>context.position(options),reset(){for(const key of Object.keys(metrics))metrics[key]=0;},setHeight(value){panelHeight=value;},setRect(value){rect=value;},setAnchor(value){anchorRect=value;}};
}

test('180 pure viewport positions use the active node without scanning 5000 IDs and keep exact fractional anchors',()=>{
 const f=positionFixture();for(let i=0;i<180;i++){f.state.view.x+=.125;f.state.view.y-=.375;f.state.view.scale=.15+i/120;f.position({viewportOnly:true});const {view}=f.state,x=10+(f.target.x+f.target.width/2)*view.scale+view.x,y=20+(f.target.y+f.target.height)*view.scale+view.y;assert.equal(f.panel.style.left,Math.max(22,Math.min(598,x-340))+'px');assert.equal(f.panel.style.top,Math.max(72,Math.min(702,y+12))+'px');}
 assert.equal(f.metrics.ids,0);assert.equal(f.metrics.canvasRects,180);assert.equal(f.metrics.panelHeights,180);
});

test('default resize/voice positioning resolves replacements live while explicit full-render targets avoid repeat lookup',()=>{
 const f=positionFixture({count:10}),replacement={...f.target,x:80.375,y:33.125};f.state.nodes[f.state.nodes.length-1]=replacement;f.reset();f.position();assert.equal(f.panel.style.left,'22px');assert.equal(f.metrics.ids,9);
 f.reset();f.position({type:'resize',target:{innerWidth:1000}});assert.equal(f.metrics.ids,9);assert.equal(f.panel.style.left,'22px');f.reset();f.position({resolvedNode:replacement});assert.equal(f.metrics.ids,0);f.context.activeNode=null;f.position({viewportOnly:true});assert.equal(f.metrics.ids,9);
});

test('viewport positioning still measures changed canvas/panel and open menus with unchanged geometry formula',()=>{
 const f=positionFixture();f.pop.hidden=false;f.setRect({left:30.125,top:45.25,width:590.5,right:620.625});f.setHeight(230.75);f.setAnchor({left:1200.125,top:310.375});f.position({viewportOnly:true});
 const w=566.5,{view}=f.state,x=30.125+(f.target.x+f.target.width/2)*view.scale+view.x,y=45.25+(f.target.y+f.target.height)*view.scale+view.y;
 assert.equal(f.panel.style.width,w+'px');assert.equal(f.panel.style.left,Math.max(42.125,Math.min(620.625-w-12,x-w/2))+'px');assert.equal(f.panel.style.top,Math.max(72,Math.min(900-230.75-18,y+12))+'px');assert.equal(f.pop.style.left,'1071.5px');assert.equal(f.pop.style.top,'162.125px');assert.equal(f.metrics.anchorRects,1);assert.equal(f.metrics.ids,0);
 f.reset();f.panel.hidden=true;f.position({viewportOnly:true});assert.deepEqual(f.metrics,{ids:0,canvasRects:0,panelHeights:0,anchorRects:0});
});

test('real render refreshes cached identity on same-ID replacement, selection, hiding and restored content',()=>{
 const f=fixture({count:4}),replacement={...f.target,x:480.625,y:70.875};f.state.nodes[0]=replacement;f.render();f.state.view.x+=.375;f.render({viewportOnly:true});const x=10+(replacement.x+replacement.width/2)*f.state.view.scale+f.state.view.x;assert.equal(f.panel.style.left,Math.max(22,Math.min(598,x-340))+'px');
 const next=f.state.nodes[1];Object.assign(next,{textMode:'generate',generation:{prompt:'新的节点',model:'gemini-3.1-flash-lite',count:1},x:900.625});f.state.selected=[next.id];f.render();f.state.view.x+=.125;f.render({viewportOnly:true});assert.equal(f.panel.querySelector('textarea').value,'新的节点');
 f.state.selected=[];f.render();const style={...f.panel.style};f.state.nodes=[];f.render({viewportOnly:true});assert.deepEqual(f.panel.style,style);assert.equal(f.panel.hidden,true);
 f.state.nodes=[replacement];f.state.selected=[replacement.id];f.state.edges=[];f.render();f.render({viewportOnly:true});assert.equal(f.panel.hidden,false);assert.equal(f.panel.querySelector('textarea').value,'写脚本');
});

module.exports={positionFixture};
