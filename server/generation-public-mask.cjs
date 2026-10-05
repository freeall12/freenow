'use strict';

const codes=new Set([
 'unsupported_generation','invalid_video_mask_media','configuration_required','configuration_invalid',
 'request_preparation_failed','dispatch_not_started','service_restarted','storage_error',
 'submission_unconfirmed','preparation_unconfirmed','media_preparation_unconfirmed','invalid_preparation_state',
 'provider_connection_unconfirmed','provider_status_unconfirmed','provider_identity_mismatch','provider_configuration_changed',
 'provider_failed','provider_cancelled','provider_configuration_required','remote_recovery_unavailable','unknown',
 'missing_outputs','invalid_outputs','contradictory_outputs','stored_outputs_invalid','stored_provider_result_invalid',
 'media_localization_failed','media_localization_unavailable','media_integrity_error','media_download_expired',
 'media_source_refresh_unavailable','media_source_provider_changed','media_source_configuration_required',
 'media_source_identity_mismatch','media_source_refresh_unconfirmed','media_source_refresh_failed',
]);
const safeCode=value=>value===undefined?undefined:codes.has(value)?value:'provider_connection_unconfirmed';

// Media preparation contains private file identities. Publish only a finite
// diagnostic vocabulary; custom exceptions must never become browser content.
function publicVideoMaskState(job){
 if(!['video.erase','video.replace'].includes(job.request?.kind))return null;
 return {
  code:safeCode(job.code),
  recovery:{
   ...(job.recovery?{reason:safeCode(job.recovery.reason),retryableLookup:job.recovery.retryableLookup===true}:{}),
   pollable:!!job.providerTaskId||!!job.providerPreparation||job.providerStatus==='succeeded'&&!!job.providerResult,
   submissionState:['queued','dispatching','accepted'].includes(job.submissionState)?job.submissionState:undefined,
  },
  localization:job.localization?{
   state:['pending','downloading','ready','failed','cancelled'].includes(job.localization.state)?job.localization.state:'failed',
   revision:Number.isSafeInteger(job.localization.revision)&&job.localization.revision>=0?job.localization.revision:0,
   errorCode:safeCode(job.localization.errorCode),retryable:job.localization.retryable===true,
  }:undefined,
 };
}
module.exports={publicVideoMaskState};
