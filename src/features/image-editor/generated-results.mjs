import {mediaSource,retainedProvenance} from '../media-preview/provenance.mjs';

// runInPlace attaches the dispatched task's origin. Keep it bound to the
// stored full-size media instead of rebuilding it from mutable node settings.
export function imageResultPatch(output){
  const source=mediaSource(output);
  return {image:output.image||output.url||source,fullImage:source,provenance:retainedProvenance(output,source)};
}

export function imageResultVersion(output,metadata={}){
  const patch=imageResultPatch(output);
  return {...metadata,...patch,prompt:patch.provenance.prompt??''};
}
