import {resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';

export function multiAngleNativeProfile(metadata){
 const selected=resolveProviderConfiguration(metadata,{kind:'image.multiAngle'}),profile=selected?.capabilities?.multiAngle;
 return selected?.protocol==='fal-native'&&profile?.semantics==='explicit-native-alternative'?profile:null;
}

export function multiAngleNativeError(values,profile){
 if(!profile)return null;
 if(values.wide_angle_lens)return '当前 Qwen 2511 原生接口不支持广角镜头，请关闭广角后生成。';
 if(!Number.isFinite(values.vertical_angle)||values.vertical_angle<-2/3)return '当前 Qwen 2511 原生接口最低倾斜角为 -30°，请提高倾斜角后生成。';
 return null;
}
