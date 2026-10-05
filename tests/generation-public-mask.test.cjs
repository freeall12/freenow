'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {publicVideoMaskState}=require('../server/generation-public-mask.cjs');
test('private preparation enables original-record lookup without publishing paths, URLs or unknown exception codes',()=>{
 const secret='private-fixture-signed-token',job={request:{kind:'video.replace'},code:secret,submissionState:secret,
  providerPreparation:{preparationId:secret,url:'https://example.invalid/'+secret,routing:{providerId:secret}},
  recovery:{reason:secret,retryableLookup:'yes',extra:secret},
  localization:{state:secret,revision:secret,errorCode:secret,retryable:'yes',resources:[secret]}};
 const value=publicVideoMaskState(job);
 assert.equal(value.code,'provider_connection_unconfirmed');assert.equal(value.recovery.pollable,true);
 assert.equal(value.recovery.retryableLookup,false);assert.equal(value.recovery.submissionState,undefined);
 assert.equal(value.localization.state,'failed');assert.equal(value.localization.revision,0);
 assert.ok(!JSON.stringify(value).includes(secret));assert.equal(value.providerPreparation,undefined);
});
test('recognized local failure and accepted identity remain useful while other generation paths are unchanged',()=>{
 const value=publicVideoMaskState({request:{kind:'video.erase'},code:'invalid_video_mask_media',recovery:{reason:'invalid_video_mask_media',retryableLookup:false},submissionState:'dispatching'});
 assert.equal(value.code,'invalid_video_mask_media');assert.equal(value.recovery.reason,'invalid_video_mask_media');assert.equal(value.recovery.pollable,false);
 assert.equal(publicVideoMaskState({request:{kind:'video.erase'},providerTaskId:'fixture',submissionState:'accepted'}).recovery.submissionState,'accepted');
 assert.equal(publicVideoMaskState({request:{kind:'video.generate'}}),null);
});
