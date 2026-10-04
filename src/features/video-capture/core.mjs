export function captureTime({mode='current',currentTime=0,duration,clip=null}) {
  if(!['current','first','last'].includes(mode))throw Error('无效的截帧模式');
  if(mode==='current')return Math.max(.001,Number.isFinite(currentTime)?currentTime:0);
  const valid=Number.isFinite(clip?.start)&&Number.isFinite(clip?.end)&&clip.end>clip.start;
  if(mode==='first')return Math.max(.001,valid?clip.start:0);
  const end=valid?clip.end:duration,start=valid?clip.start:0;
  if(!Number.isFinite(end)||end<=0)throw Error('预览尚未解析出时长，无法截尾帧，请稍候再试。');
  return Math.max(.001,start,end-.001);
}
