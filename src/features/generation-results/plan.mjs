const clone=value=>structuredClone(value);
const fail=(message,code='invalid_result_plan')=>{throw Object.assign(new Error(message),{code});};
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const purpose=edge=>edge.purpose??edge.data?.purpose;
const inputEdge=edge=>purpose(edge)==null||['generation-input','draft-reference'].includes(purpose(edge));
const incoming=(edges,id)=>edges.filter(edge=>edge.target===id&&inputEdge(edge));
const hidden=(nodes,id)=>nodes.some(node=>node.type==='pile'&&node.memberIds?.includes(id));
const fingerprint=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const content=node=>{const value=clone(node);delete value.x;delete value.y;delete value.selected;return value;};
const cleanFields=['options','versions','imageHistory','videoHistory','textHistory','historyVariantCount','historyLocalQueues','historyLocalQueueMetadata','historyLocalQueueResourceMetadata','taskInfo','__metadata','currentSourceFileId','currentImageOptionId','currentVideoOptionId','historySourceNodeId','generationRun','generationRecovery','pendingOperation'];
const mediaFields=['image','fullImage','video','audio','text','poster','thumbnail','pixelWidth','pixelHeight','videoMetadata','audioMetadata','clip','cutoutResult','fileID','sourceFileId'];

export function hasResult(node){
 return node?.type==='image'?nonempty(node.fullImage)||nonempty(node.image):node?.type==='text'?nonempty(node.content)||nonempty(node.text):nonempty(node?.[node?.type]);
}

/** A content guard allows canvas dragging, but rejects edited/deleted sources or inputs. */
export function captureResultSnapshot(nodes,edges,sourceNodeId){
 const source=nodes.find(node=>node.id===sourceNodeId);
 if(!source||hidden(nodes,sourceNodeId))fail('生成来源不存在或属于隐藏堆叠成员');
 const inputs=incoming(edges,sourceNodeId),references=[];
 for(const id of new Set(inputs.map(edge=>edge.source))){const node=nodes.find(item=>item.id===id);if(!node)fail('生成参考节点已不存在');references.push({id,value:fingerprint(content(node))});}
 return {sourceNodeId,source:fingerprint(content(source)),inputEdges:fingerprint(inputs),references};
}

export function assertResultSnapshot(snapshot,nodes,edges){
 const current=captureResultSnapshot(nodes,edges,snapshot.sourceNodeId);
 if(fingerprint(current)!==fingerprint(snapshot))fail('生成来源或参考已变化，请重新生成','stale_result_plan');
 return true;
}

/** Atomic graph commit must also reject a moved source: the caller can re-plan at its new position. */
export function assertPlanCurrent(plan,nodes,edges){
 assertResultSnapshot(plan.snapshot,nodes,edges);
 const source=nodes.find(node=>node.id===plan.snapshot.sourceNodeId);
 if(source.x!==plan.sourcePosition.x||source.y!==plan.sourcePosition.y)fail('来源坐标已变化，请重新规划结果位置','stale_result_plan');
 const added=plan.nodeChanges.filter(change=>change.type==='add').map(change=>change.item.id);
 if(nodes.some(node=>added.includes(node.id))||edges.some(edge=>plan.edgeChanges.some(change=>change.item.id===edge.id)))fail('生成结果标识已被占用','stale_result_plan');
 return true;
}

function clean(node,{clearMedia=false}={}){
 const result=clone(node);for(const field of cleanFields)delete result[field];
 if(clearMedia){for(const field of mediaFields)delete result[field];result[node.type==='text'?'text':node.type]='';if(node.type==='text')result.content='';}
 return result;
}

function spread(nodes,ids){
 const source=nodes.find(node=>node.id===ids[0]),columns=Math.ceil(Math.sqrt(ids.length)),index=new Map(ids.map((id,i)=>[id,i]));
 return nodes.map(node=>{const at=index.get(node.id);return !at?node:{...node,x:source.x+(at%columns)*(source.width+64),y:source.y+Math.floor(at/columns)*(source.height+64)};});
}

function pile(nodes,ids,nextId,rules){
 const max=rules.maxMembers??50,allowed=rules.allowedMemberTypes?.map(type=>type.toLowerCase())??['image','video','audio','text'];
 const members=ids.map(id=>nodes.find(node=>node.id===id));
 if(rules.enabled===false||members.length>max||members.some(node=>!allowed.includes(node.type)||hidden(nodes,node.id)))fail('当前结果无法创建堆叠');
 const visible=members.slice(-5).map(node=>{const scale=node.type==='text'?Math.min(320/node.width,320/node.height,1):1;return {width:node.width*scale,height:node.height*scale};});
 const width=Math.max(...visible.map(node=>node.width)),height=Math.max(...visible.map(node=>node.height));
 const left=Math.min(...members.map(node=>node.x)),top=Math.min(...members.map(node=>node.y)),right=Math.max(...members.map(node=>node.x+node.width)),bottom=Math.max(...members.map(node=>node.y+node.height));
 const parent=members[0].parentId,parentId=parent&&members.every(node=>node.parentId===parent)&&nodes.some(node=>node.id===parent)?parent:undefined;
 // Local grouped coordinates are already absolute; official J3e's relative conversion is unnecessary.
 const result={id:nextId('pile'),type:'pile',title:'堆叠',selected:false,x:(left+right-width)/2,y:(top+bottom-height)/2,width,height,memberIds:[...ids],...(parentId?{parentId}:{})};
 const memberIds=new Set(ids);
 return {nodes:nodes.map(node=>{if(!memberIds.has(node.id)||(!node.parentId&&node.extent===undefined))return node;const next={...node};delete next.parentId;delete next.extent;return next;}).concat(result),pileNode:result};
}

/**
 * Pure official g4e/S4e/fL layout adaptation to local flat nodes.
 * idFactory(kind) receives node/edge/request/pile and must return a fresh string.
 * No graph mutation, clocks, network, task submission, or random IDs occur here.
 * Media variants remain owned by the existing history path; text variants use spread.
 */
export function planGenerationResults({nodes,edges,sourceNodeId,resultCount,resultsPerRequest=1,runId,resultLayout='spread',idFactory,sourceNodeSnapshot,sourceInputEdges,editorPrompt,regenerationMode='preserve-source',pileRules={}}){
 if(!Array.isArray(nodes)||!Array.isArray(edges)||typeof idFactory!=='function'||!nonempty(runId))fail('缺少生成结果规划参数');
 if(!Number.isSafeInteger(resultCount)||resultCount<1||!Number.isSafeInteger(resultsPerRequest)||resultsPerRequest<1)fail('结果数和每次请求结果数必须为正整数');
 const source=nodes.find(node=>node.id===sourceNodeId);
 if(!source||!['image','video','text','audio'].includes(source.type)||hidden(nodes,sourceNodeId))fail('生成来源不存在或属于隐藏堆叠成员');
 if(![source.x,source.y,source.width,source.height].every(Number.isFinite)||source.width<=0||source.height<=0)fail('来源节点坐标或尺寸无效');
 if(!['preserve-source','replace-source'].includes(regenerationMode))fail('重新生成方式无效');
 if(!['spread','pile','variants'].includes(resultLayout))fail('结果布局无效');
 if(resultLayout==='variants'&&source.type!=='text')fail('媒体变体应使用现有历史结果路径','variants_history_required');
 const layout=resultLayout==='variants'?'spread':resultLayout;
 if(source.type==='text')regenerationMode='replace-source';
 const snapshot=captureResultSnapshot(nodes,edges,sourceNodeId),inputs=incoming(sourceInputEdges??edges,sourceNodeId);
 if(inputs.some(edge=>!nodes.some(node=>node.id===edge.source)))fail('生成参考节点已不存在');
 const used=new Set([...nodes,...edges].map(item=>item.id)),nextId=kind=>{const id=idFactory(kind);if(!nonempty(id)||used.has(id))fail('生成结果标识无效或重复');used.add(id);return id;};
 const template=sourceNodeSnapshot?.id===source.id&&sourceNodeSnapshot.type===source.type?sourceNodeSnapshot:source;
 const preservesSourceNode=hasResult(source)&&regenerationMode==='preserve-source';
 // Templates carry submit-time settings, while live geometry and ownership always win.
 const base={...clone(template),id:source.id,type:source.type,x:source.x,y:source.y,width:source.width,height:source.height};
 for(const field of ['parentId','extent']){delete base[field];if(source[field]!==undefined)base[field]=clone(source[field]);}
 if(editorPrompt!==undefined){base.prompt=editorPrompt;base.generation={...base.generation,prompt:editorPrompt};}
 if(resultCount>1||preservesSourceNode){base.generation={...base.generation,count:1,times:1};if(base.params)base.params={...base.params,count:1,times:1};}
 const targets=Array.from({length:resultCount},(_,i)=>{const created=preservesSourceNode||i>0,node=clean(base,{clearMedia:created});if(created){node.id=nextId('node');node.selected=false;}return node;});
 const requestPlans=[];
 for(let at=0;at<targets.length;at+=resultsPerRequest){const requestId=nextId('request');requestPlans.push({requestId,targets:targets.slice(at,at+resultsPerRequest).map((node,resultIndex)=>({nodeId:node.id,resultIndex}))});}
 requestPlans.forEach(request=>request.targets.forEach(({nodeId,resultIndex})=>{const node=targets.find(item=>item.id===nodeId);node.pendingOperation=`${source.type}.generate`;node.generationRun={runId,requestId:request.requestId,resultIndex};}));
 const targetNodeIds=targets.map(node=>node.id),createdTargetNodeIds=targetNodeIds.filter(id=>id!==source.id),layoutNodeIds=preservesSourceNode?[source.id,...targetNodeIds]:targetNodeIds;
 let nextNodes=preservesSourceNode?nodes.concat(targets):nodes.map(node=>node.id===source.id?targets[0]:node).concat(targets.slice(1)),pileNode;
 if(layoutNodeIds.length>1){if(layout==='spread')nextNodes=spread(nextNodes,layoutNodeIds);else({nodes:nextNodes,pileNode}=pile(nextNodes,layoutNodeIds,nextId,pileRules));}
 const addedEdges=createdTargetNodeIds.flatMap(target=>inputs.map(edge=>{const next={id:nextId('edge'),source:edge.source,target};for(const field of ['sourceHandle','targetHandle','order','valueKey','purpose']){const value=Object.hasOwn(edge,field)?edge[field]:edge.data?.[field];if(value!==undefined)next[field]=clone(value);}return next;}));
 const byId=new Map(nodes.map(node=>[node.id,node])),nodeChanges=nextNodes.flatMap(node=>byId.has(node.id)?byId.get(node.id)===node?[]:[{type:'replace',id:node.id,item:node}]:[{type:'add',item:node}]);
 return {nodes:nextNodes,edges:edges.concat(addedEdges),nodeChanges,edgeChanges:addedEdges.map(item=>({type:'add',item})),pendingTargetNodes:targetNodeIds.map(id=>nextNodes.find(node=>node.id===id)),targetNodeIds,createdTargetNodeIds,layoutNodeIds,preservesSourceNode,isRegeneration:hasResult(template),requestPlans,pileNode,snapshot,sourcePosition:{x:source.x,y:source.y},additionalParameters:{batch_count:requestPlans.length,batch_id:runId,is_regeneration:hasResult(template),layout}};
}
