const {performance}=require('node:perf_hooks');
(async()=>{
 const [THREE,{ScenePlayback}]=await Promise.all([import('three'),import('../playback.mjs')]),content=new THREE.Scene(),animations=[],cameras=[];
 for(let i=0;i<400;i++)content.add(new THREE.Group());
 for(let i=0;i<120;i++){const camera=new THREE.PerspectiveCamera();camera.userData.studioId='camera-'+i;content.add(camera);cameras.push(camera);animations.push(new THREE.AnimationClip('motion-'+i,2,[new THREE.VectorKeyframeTrack(camera.uuid+'.position',[0,2],[0,0,0,1,0,0])]));}
 const playback=new ScenePlayback({content,animations}),catalog=playback.catalog.bind(playback);let calls=0;playback.catalog=()=>{calls++;return catalog();};
 const repeated=()=>{const counts=cameras.map(camera=>playback.catalog().filter(clip=>clip.cameraIds.includes(camera.userData.studioId)).length),motions=playback.catalog().flatMap(clip=>clip.cameraIds);return {counts,motions};};
 const snapshot=()=>{const clips=playback.catalog(),byCamera=new Map();for(const clip of clips)for(const id of new Set(clip.cameraIds))byCamera.set(id,(byCamera.get(id)||0)+1);return {counts:cameras.map(camera=>byCamera.get(camera.userData.studioId)||0),motions:clips.flatMap(clip=>clip.cameraIds)};};
 const results={};for(const [name,run] of [['repeated',repeated],['snapshot',snapshot]]){run();const samples=[];let result;for(let i=0;i<7;i++){calls=0;const start=performance.now();result=run();samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);results[name]={catalogCalls:calls,medianMs:samples[3],minMs:samples[0],maxMs:samples[6],cameraCount:result.counts.length,motionAssociations:result.motions.length};}
 console.log(JSON.stringify({scope:'metadata only: real ScenePlayback catalog, shot counts, ordered motion camera IDs; excludes DOM, runtime.find, loading, encoding, GPU and overall FPS',synthetic:{groups:400,cameras:120,clips:120,descendants:520},samplesPerPath:7,...results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
