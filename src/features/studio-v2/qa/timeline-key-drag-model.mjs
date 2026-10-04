import {createNumberFieldModel} from './number-field-model.mjs';
export function createTimelineKeyDragModel(){
  const model=createNumberFieldModel();model.scene.name='QA 时间轴身份保护';
  const second=model.animations[0].clone();second.name=model.animations[0].name='QA 同名运镜';
  for(let i=0;i<second.tracks[0].values.length;i+=3)second.tracks[0].values[i]+=10;
  model.animations.push(second);return model;
}
