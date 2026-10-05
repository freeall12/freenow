// GPU ID rasterization and Spark raycast must describe the same physical pixel.
export function pickPixel(u,v,width,height){
  if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>=1||v<0||v>=1||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)return null;
  const x=Math.floor(u*width),y=Math.floor(v*height);return {u:(x+.5)/width,v:(y+.5)/height};
}
export function nearestSceneHit(mesh,splat){
  if(!splat)return mesh?.id??null;if(!mesh)return splat.proxy.userData.studioId??null;
  if(!Number.isFinite(mesh.depth)||mesh.depth<0||mesh.depth>1||!Number.isFinite(splat.depth)||splat.depth<0||splat.depth>1)throw Error('片场命中深度无效，请重新点选');
  // The production framebuffer uses conventional 24-bit depth. Resolve one
  // depth-cell ties to its mesh ID to avoid flickering on coincident surfaces.
  const cell=depth=>Math.min(16777215,Math.floor(depth*16777216));
  return cell(mesh.depth)<=cell(splat.depth)?mesh.id:splat.proxy.userData.studioId??null;
}
