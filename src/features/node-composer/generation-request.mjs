import {projectSubjects,subjectIds} from '../subject-library/model.mjs';
import {listSubjects,readySubjects} from '../subject-library/store.mjs';
import {assetReferences,libraryPolicy,projectAssets} from './library-mentions.mjs';
import {prepareVideoRequest} from '../video-generation/settings.mjs';
import {prepareImageRequest} from '../image-generation/request.mjs';

// Agent calls may bypass the editor. Expand snapshots before counting image inputs.
// Already expanded UI requests must not prepend upstream text a second time.
export function prepareGenerationRequest(request) {
  if(!['image.generate','video.generate'].includes(request.kind))return request;
  let prepared=request;
  if(assetReferences(request.prompt||'').length){
    const settings=request.parameters||{};
    const policy=libraryPolicy(request.kind.split('.')[0],settings.model||settings.modelId,settings.mode||settings.videoMode);
    if(!policy.enabled)throw Error('当前模型或模式不支持素材库引用');
    prepared={...request,...projectAssets(request.prompt,request.inputs||[],policy.allowed)};
  }
  if(subjectIds(prepared.prompt||'').length || (prepared.prompt||'').includes('{{ElementRef:'))prepared=projectSubjects(prepared,prepared.parameters?.subjects|| (typeof window!=='undefined'?listSubjects():[]));
  return prepareVideoRequest(prepareImageRequest(prepared));
}

export async function prepareGenerationRequestReady(request){
  if(['image.generate','video.generate'].includes(request.kind)&&(subjectIds(request.prompt||'').length||(request.prompt||'').includes('{{ElementRef:')))await readySubjects();
  return prepareGenerationRequest(request);
}
