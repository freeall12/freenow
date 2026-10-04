// Display precision must never become an authored transform. The official
// inspector commits only an explicit input draft, and Escape clears that draft.
export function bindInspectorNumberField(input,{read,format,commit}){
  let draft=null;
  function cancel(){draft=null;input.value=format();}
  input.oninput=()=>{draft=input.value;};
  input.onblur=()=>{
    const text=draft;draft=null;
    try{
      if(text!==null&&text.trim()){
        const value=Number(text);
        if(Number.isFinite(value)&&value!==read())commit(value);
      }
    }finally{input.value=format();}
  };
  input.onkeydown=event=>{
    event.stopPropagation();
    if(event.key==='Enter')input.blur();
    else if(event.key==='Escape')cancel();
  };
  cancel();
  return {cancel};
}
