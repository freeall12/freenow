import {providerConfigured,resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';

// A public display label describes the operator's actual selection. Keep the
// complete vendor name: MiniMax H3 is a video model, Tripo H3 is a 3D family.
export function worldProviderPresentation(model,metadata,{image=false}={}){
 const alias=model.provider==='tripo'?`tripo-${image?'image':'text'}-to-model-h3`:model.id;
 const request={kind:'world.generate',parameters:{model:alias}},selected=resolveProviderConfiguration(metadata,request);
 const declared=selected?.capabilities?.models?.[alias];
 const label=selected?.protocol==='tripo-native'&&declared?.kind==='world.generate'&&['Tripo H3.0','Tripo H3.1'].includes(declared.label)?declared.label:model.label;
 return {label,alias,configured:providerConfigured(metadata,request),protocol:selected?.protocol||null};
}
