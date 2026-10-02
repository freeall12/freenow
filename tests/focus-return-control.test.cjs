const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
 const {createReturnControl}=await import('../src/features/focus-edit/return-control.mjs');
 const node={id:'source',x:53800.25,y:-1800.875,width:446.125,height:250.375},state={nodes:[node],view:{x:0,y:0,scale:.6375}},canvas={clientWidth:1200,clientHeight:800},transitions=[];
 const document={createElement:()=>({})},container={ownerDocument:document,children:[],append(...items){this.children.push(...items);}},app={getState:()=>state,transitionView:(view,duration)=>transitions.push({view,duration})};
 let geometry=null;const control=createReturnControl({app,sourceId:'source',container,canvas,layout:n=>({...n,...geometry})});
 return {node,state,canvas,transitions,control,button:container.children[0],divider:container.children[1],layout(value){geometry=value;},center(dx=0,dy=0){state.view.x=canvas.clientWidth/2-(node.x+node.width/2+dx)*state.view.scale;state.view.y=canvas.clientHeight/2-(node.y+node.height/2+dy)*state.view.scale;control.update();}};
}
test('focus return visibility uses the strict 200-world-unit source distance at every zoom',async()=>{
 const f=await fixture();assert.equal(f.button.hidden,false);assert.equal(f.divider.hidden,false);
 // A binary scale makes the exact threshold independent of floating roundoff.
 for(const scale of [.5,1,2]){f.state.view.scale=scale;f.center(200);assert.equal(f.button.hidden,true);f.center(200.125);assert.equal(f.button.hidden,false);f.center(0,200);assert.equal(f.button.hidden,true);}
 f.center();assert.equal(f.divider.hidden,true);f.state.nodes=[];f.control.update();assert.equal(f.button.hidden,true);f.button.onclick();assert.equal(f.transitions.length,0);
});
test('return keeps current fractional zoom, duration and official vertical offset without changing graph data',async()=>{
 const f=await fixture(),before=structuredClone(f.node);f.button.onclick();const {view,duration}=f.transitions[0];
 assert.equal(duration,500);assert.equal(view.scale,.6375);assert.equal(view.x,600-(f.node.x+f.node.width/2)*.6375);assert.equal(view.y,400-(f.node.y+f.node.height/2+f.node.height*.4)*.6375);assert.deepEqual(f.node,before);
 f.state.view.scale=1.125;f.canvas.clientWidth=803;f.canvas.clientHeight=611;f.node.x+=.375;f.button.onclick();assert.equal(f.transitions[1].view.x,803/2-(f.node.x+f.node.width/2)*1.125);assert.equal(f.transitions[1].view.scale,1.125);
});
test('rendered layout overrides follow the source shell and resize refreshes the threshold',async()=>{
 const f=await fixture();f.state.view={x:0,y:0,scale:1};f.layout({x:500,y:350,width:200,height:100});f.control.update();assert.equal(f.button.hidden,true);
 f.canvas.clientWidth=1601;f.control.update();assert.equal(f.button.hidden,false);f.button.onclick();assert.deepEqual(f.transitions[0],{duration:500,view:{scale:1,x:200.5,y:-40}});
 assert.match(f.button.innerHTML,/M12 12m-7/);assert.equal(f.button.ariaLabel,'返回来源节点');
});
