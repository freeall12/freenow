// Both Studio editors use the conversation draft as their single source of truth.
export function createComposerChannel(){
  let adapter=null;
  const listeners=new Set();
  function read(nodeId){return adapter?.read(nodeId)||null;}
  function publish(){for(const listener of [...listeners])listener.onChange(read(listener.nodeId));}
  return {
    configure(next){adapter=next;publish();},read,publish,
    subscribe(nodeId,onChange){const listener={nodeId,onChange};listeners.add(listener);onChange(read(nodeId));return()=>listeners.delete(listener);},
    write(nodeId,text){if(!adapter)throw Error('Agent 输入区正在加载');return adapter.write(nodeId,text);},
    open(nodeId){if(!adapter)throw Error('Agent 输入区正在加载');return adapter.open(nodeId);},
    submit(nodeId){if(!adapter)throw Error('Agent 输入区正在加载');return adapter.submit(nodeId);},
    stop(nodeId){if(!adapter?.stop)throw Error('当前任务无法停止');return adapter.stop(nodeId);}
  };
}
export const studioComposer=createComposerChannel();
