export const defaults=Object.freeze({rotate_right_left:-30,move_forward:0,vertical_angle:.5,wide_angle_lens:false});
const clamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;
export function parameters(value={}){return {rotate_right_left:clamp(value.rotate_right_left,-90,90,defaults.rotate_right_left),move_forward:clamp(value.move_forward,0,10,defaults.move_forward),vertical_angle:clamp(value.vertical_angle,-1,1,defaults.vertical_angle),wide_angle_lens:typeof value.wide_angle_lens==='boolean'?value.wide_angle_lens:defaults.wide_angle_lens};}
export function change(value,patch){const next=parameters({...value,...patch});for(const key of ['rotate_right_left','move_forward','vertical_angle'])next[key]=Math.round(next[key]*100)/100;return next;}
export function drag(value,dx,dy){return change(value,{rotate_right_left:value.rotate_right_left-dx*.5,vertical_angle:value.vertical_angle-dy*.01});}
export function cubeTransform(value){const p=parameters(value),scale=1+p.move_forward*.1;return `rotateX(${p.vertical_angle*45}deg) rotateY(${-p.rotate_right_left}deg) scale3d(${scale}, ${scale}, ${scale})`;}
export function requestParameters(value){const p=parameters(value);return {...p,rotate_right_left:-p.rotate_right_left};}
export function panelPosition(node,view){return {left:(node.x+node.width/2-300)*view.scale+view.x,top:(node.y+node.height+12)*view.scale+view.y,scale:view.scale};}
