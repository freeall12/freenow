// Seed only a new isolated QA canvas. Existing sessions keep their original
// source bindings, approvals, history and assets exactly as recorded.
(()=>{
 const fixture=window.AgentSegmentationFixture,store=window.CanvasStore,load=store.load.bind(store),pending=new Map();
 const expected='6f1626326e04801beac78be182d855fffcd30e4067fe3cb72c94392a8f06a306';
 const hash=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');
 async function verifiedPut(blob){
  const sha256=await hash(blob),ref=await window.LocalAssets.put(blob),url=await window.LocalAssets.url(ref),response=await fetch(url);
  if(!response.ok)throw Error('QA source asset readback failed.');
  const back=await response.blob();if(back.size!==blob.size||await hash(back)!==sha256)throw Error('QA source asset readback differs.');
  return {ref,sha256,bytes:blob.size};
 }
 async function initialize(id){
  const saved=await load(id);if(saved!=null||id!=='canvas')return saved;
  const response=await fetch('/qa/sam2-source.mp4');if(!response.ok)throw Error('QA source MP4 unavailable.');
  const blob=await response.blob();if(blob.type!=='video/mp4'||await hash(blob)!==expected)throw Error('QA source MP4 identity differs.');
  const url=URL.createObjectURL(blob);let metadata;
  try{const {inspectVideoThumbnail}=await import('../../generation-history/video-thumbnail.mjs');metadata=await inspectVideoThumbnail(url);}
  finally{URL.revokeObjectURL(url);}
  if(metadata.width!==320||metadata.height!==180||Math.abs(metadata.duration-5)>.01||!metadata.thumbnailBlob?.size)throw Error('QA source decode differs.');
  const video=await verifiedPut(blob),poster=await verifiedPut(metadata.thumbnailBlob),nodes=structuredClone(window.CANVAS_DATA.nodes);
  if(nodes.length!==1||nodes[0].id!=='agent-segmentation-source')throw Error('QA source seed is not unique.');
  Object.assign(nodes[0],{video:video.ref,image:poster.ref,poster:poster.ref,pixelWidth:320,pixelHeight:180,durationMs:5000,provenance:{kind:'imported',mediaSource:video.ref,model:null}});
  await store.save({version:1,nodes,edges:[],history:[],future:[]},id,{preserveSnapshot:true});
  fixture.sourceAsset={video,poster,width:320,height:180,duration:metadata.duration};
  return load(id);
 }
 store.load=(id=window.CanvasProjects?.id()||'canvas')=>{
  if(!pending.has(id))pending.set(id,initialize(id).catch(error=>{fixture.errors.push({source:error.message});throw error;}));
  return pending.get(id).then(()=>load(id));
 };
})();
