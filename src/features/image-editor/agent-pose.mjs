import {defaultPose,drawPose,poseLinks} from '../../../image-editor-pose.mjs';

export const poseColors=Object.freeze(['red','blue','green','yellow']);
export const poseSize=Object.freeze({width:600,height:440});
export const poseJointNames=Object.freeze(Object.keys(defaultPose()));
const invalid=message=>Object.assign(new Error(message),{code:'invalid_argument'});
export function normalizePose(input={},base){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['color','joints'].includes(key)))throw invalid('pose 仅接受 color 和 joints');
  const color=input.color??base?.color??'red';
  if(!poseColors.includes(color))throw invalid('姿势颜色必须为 red/blue/green/yellow');
  const points=Object.fromEntries(Object.entries(base?.joints||defaultPose()).map(([key,value])=>[key,[...value]]));
  if(input.joints!==undefined){
    if(!input.joints||typeof input.joints!=='object'||Array.isArray(input.joints)||!Object.keys(input.joints).length)throw invalid('joints 需要明确的关节点');
    for(const [key,value]of Object.entries(input.joints)){
      if(!poseJointNames.includes(key)||!Array.isArray(value)||value.length!==2||value.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>6000))throw invalid('关节点需要 600×440 姿势源像素坐标 [x,y]，范围 -6000..6000');
      points[key]=[...value];
    }
  }
  return {color,joints:points};
}
// Bind saved joint metadata to the actual raster source. UI replacement or
// source edits must not make stale joints look like an editable pose image.
export function poseSourceStamp(source){let hash=2166136261;for(let i=0;i<source.length;i++)hash=Math.imul(hash^source.charCodeAt(i),16777619);return `${source.length}:${hash>>>0}`;}
export function readLayerPose(object){
  const data=object.agentPose;
  if(!data||data.version!==1||typeof object.getSrc!=='function'||data.sourceStamp!==poseSourceStamp(object.getSrc()))return null;
  try{const pose=normalizePose({color:data.color,joints:data.joints});if(poseJointNames.some(key=>!Object.hasOwn(data.joints,key)))return null;return {...pose,coordinateSpace:'pose-source-pixels',...poseSize};}catch{return null;}
}
export const canRegeneratePose=object=>!!readLayerPose(object)&&object.width===600&&object.height===440&&!object.cropX&&!object.cropY&&!object.clipPath&&!object.filters?.length&&!object.resizeFilter;
export function renderPoseSource(pose,createCanvas=()=>document.createElement('canvas')){
  const target=createCanvas();target.width=600;target.height=440;
  const context=target.getContext('2d');if(!context)throw Object.assign(new Error('姿势画布无法创建'),{code:'render_unavailable'});
  drawPose(context,{points:pose.joints,selected:new Set(),drag:null,marquee:null},pose.color,false);
  const source=target.toDataURL('image/png');if(!source.startsWith('data:image/png;base64,')||source.length<30)throw Object.assign(new Error('姿势 PNG 编码失败'),{code:'render_failed'});
  return {source,metadata:{version:1,color:pose.color,joints:pose.joints,sourceStamp:poseSourceStamp(source)}};
}
export function poseCapabilities(){return {...poseSize,coordinateSpace:'pose-source-pixels',colors:[...poseColors],defaultJoints:defaultPose(),links:poseLinks.map(link=>[...link])};}
