import {el} from './dom.mjs';
import {bindInspectorNumberField} from './inspector-number-field.mjs';
const degrees=r=>r*180/Math.PI;
export function propertyControls(runtime,object){
  const root=el('div','_objectProperties_1umd8_1');
  for(const [field,label] of [['position','位置'],['rotation','旋转（°）'],['scale','缩放']]){
    const group=el('fieldset');group.append(el('legend','',label));const axes=el('div','_objectAxes_1umd8_16');
    const read=()=>object[field].toArray().slice(0,3).map(n=>field==='rotation'?degrees(n):n);
    for(let axis=0;axis<3;axis++){
      const wrapper=el('div','_field_1i3al_1'),handle=el('span','_axis_1i3al_20','XYZ'[axis]),input=el('input','_input_1i3al_29');input.type='number';input.step='any';input.ariaLabel=label+' '+'XYZ'[axis];handle.setAttribute('aria-hidden','true');const format=()=>String(Number(read()[axis].toFixed(field==='rotation'?1:3)));input.value=format();let drag=null;
      function commit(value,history=true){if(!Number.isFinite(value))return;const next=read();if(next[axis]===value)return;next[axis]=value;runtime.update(object.userData.studioId,{[field]:next},{history,notify:history});}
      const numeric=bindInspectorNumberField(input,{read:()=>read()[axis],format,commit});
      handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();input.focus({preventScroll:true});numeric.cancel();drag={x:e.clientX,value:read()[axis],active:false};handle.setPointerCapture(e.pointerId);};
      handle.onpointermove=e=>{if(!drag||!handle.hasPointerCapture(e.pointerId))return;const delta=e.clientX-drag.x;if(!drag.active){if(Math.abs(delta)<3)return;runtime.beginEdit();drag.active=true;}drag.x=e.clientX;drag.value+=delta*(field==='rotation'?.1:.01)*(e.shiftKey?.1:1);commit(Number(drag.value.toFixed(4)),false);input.value=format();};
      const end=()=>{if(!drag)return;const changed=drag.active;drag=null;if(changed)runtime.commit();};handle.onpointerup=e=>{end();if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);};handle.onpointercancel=handle.onlostpointercapture=end;wrapper.append(handle,input);axes.append(wrapper);
    }
    group.append(axes);root.append(group);
  }
  return root;
}
