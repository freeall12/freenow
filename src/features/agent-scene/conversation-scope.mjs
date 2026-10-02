// Switching the host surface selects a conversation; it never rewrites that
// conversation's scene binding, history or composer draft.
export function canvasConversationIndex(chats,current,{sceneNodeId,busy=false}={}){
  if(busy||sceneNodeId||!chats[current]?.studioNodeId)return current;
  let selected=-1,latest=-Infinity;
  for(let index=0;index<chats.length;index++){
    const chat=chats[index];if(chat.studioNodeId)continue;
    const time=Date.parse(chat.updatedAt||chat.createdAt)||0;
    if(time>=latest){selected=index;latest=time;}
  }
  return selected;
}
export function newConversationScope(chat,sceneNodeId){
  const nodeId=chat?.studioNodeId;
  return nodeId&&nodeId===sceneNodeId?{studioNodeId:nodeId,skills:['3d-scene-director'],refs:[nodeId]}:{};
}
