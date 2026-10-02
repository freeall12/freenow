import { modelFor, normalize, providerParameters } from './catalog.mjs';
import { apiParameters as cameraParameters, supportsCamera } from '../camera-control/settings.mjs';

export function prepareImageRequest(request) {
  if (request.kind !== 'image.generate') return request;
  const settings = request.parameters || {};
  const model = modelFor(settings.model || settings.modelId);
  if (!model) return request;
  const images = (request.inputs || []).filter(input => input.type === 'image');
  // Count the submitted inputs, never a stale count copied from a node draft.
  const config = normalize({ ...settings, refs: images, inputCounts: images.length }, model);
  const parameters = {
    ...config,
    modelId: model.id,
    providerParameters: providerParameters(config),
  };
  // Reference URLs belong to inputs; do not duplicate them in provider settings.
  delete parameters.refs;
  delete parameters.inputCounts;
  if (supportsCamera(model.id)) parameters.cameraControl = cameraParameters(config);
  else delete parameters.cameraControl;
  return { ...request, parameters };
}
