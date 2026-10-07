const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const path=require.resolve('../src/features/agent-apps/resources/apps/actor-emotion@v1.63ee986b.html'),html=fs.readFileSync(path,'utf8'),modulePromise=import('../src/features/agent-apps/actor-emotion-local-resources.mjs');
const original='typeof createImageBitmap>"u"||P&&w<17||C&&u<98?this.textureLoader=new kn(this.options.manager):this.textureLoader=new Nn(this.options.manager)',local='this.textureLoader=new kn(this.options.manager)';
function embeddedGlb(source) {
  const match=/KK=new URL\("data:model\/gltf-binary;base64,([A-Za-z0-9+/=]+)/.exec(source);assert.ok(match);const bytes=Buffer.from(match[1],'base64');
  assert.equal(bytes.readUInt32LE(),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString()),binStart=20+jsonLength+8;
  const texture=json.images[0],view=json.bufferViews[texture.bufferView],image=bytes.subarray(binStart+(view.byteOffset||0),binStart+(view.byteOffset||0)+view.byteLength);
  return {bytes,json,image};
}
test('actor-only SHA-bound derivative changes only loader, confirmation persistence and close lifecycle, preserving captured source bytes',async()=>{
  const m=await modulePromise,localized=await m.localizeActorEmotionResources(html,'actor-emotion','v1');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),m.actorEmotionReferenceSha256);
  const confirmation='await JK();try{const D=await gb(RD,g,Gg,A);',savedConfirmation='await JK();try{rB!==null&&(clearTimeout(rB),rB=null);await FK(IT(g));const D=await gb(RD,g,Gg,A);';
  const {localLifecycleScript}=await import('../src/features/agent-apps/local-lifecycle.mjs'),startup='Qb();</script>',bridge='async function actorCloseFlush(){if(!RD||!zA)return false;SB();if(rB!==null){clearTimeout(rB);rB=null}await FK(IT(zA));return true}'+localLifecycleScript({root:'PM',flush:'actorCloseFlush()',busy:'hg'});
  assert.equal(html.split(original).length,2);assert.equal(html.split(confirmation).length,2);assert.equal(html.split(startup).length,2);assert.equal(localized,html.replace(original,local).replace(confirmation,savedConfirmation).replace(startup,bridge+startup));assert.equal(fs.readFileSync(path,'utf8'),html);
  assert.equal(await m.localizeActorEmotionResources(html,'director-markup','v1'),html);
  await assert.rejects(m.localizeActorEmotionResources(html,'actor-emotion','v2'));
  await assert.rejects(m.localizeActorEmotionResources(html+'\n','actor-emotion','v1'));
  await assert.rejects(m.localizeActorEmotionResources(html.replace(original,local),'actor-emotion','v1'));
});
test('actual embedded GLB, material and JPEG texture bytes remain identical in derived renderer',async()=>{
  const m=await modulePromise,localized=await m.localizeActorEmotionResources(html,'actor-emotion','v1'),before=embeddedGlb(html),after=embeddedGlb(localized);
  assert.deepEqual(after.bytes,before.bytes);assert.equal(crypto.createHash('sha256').update(after.bytes).digest('hex'),'63b4de1395ba17a1bd9f62f91928fa3664741f05cce44b77461446a146afd573');
  assert.equal(before.json.images.length,1);assert.equal(before.json.images[0].mimeType,'image/jpeg');assert.equal(before.json.images[0].name,'FBHead_baked_tex');
  assert.equal(before.json.materials[0].pbrMetallicRoughness.baseColorTexture.index,0);assert.deepEqual(after.image,before.image);assert.equal(before.image.readUInt16BE(),0xffd8);assert.equal(before.image.readUInt16BE(before.image.length-2),0xffd9);
});
test('official modern selector uses fetch ImageBitmapLoader; derivative chooses packaged image TextureLoader under same environment',async()=>{
  const m=await modulePromise,localized=await m.localizeActorEmotionResources(html,'actor-emotion','v1');
  const context={createImageBitmap:()=>{},P:false,w:18,C:false,u:130,kn:class TextureLoader {constructor(){this.kind='image';}},Nn:class ImageBitmapLoader {constructor(){this.kind='fetch';}}};vm.createContext(context);
  vm.runInContext(`globalThis.renderer={options:{manager:{}}};(function(){${original}}).call(renderer)`,context);assert.equal(context.renderer.textureLoader.kind,'fetch');
  assert.ok(localized.includes(local+',this.textureLoader.setCrossOrigin'));
  vm.runInContext(`(function(){${local}}).call(renderer)`,context);assert.equal(context.renderer.textureLoader.kind,'image');
  const textureLoader=html.slice(html.indexOf('class kn extends pC'),html.indexOf('class DM extends'));
  assert.match(textureLoader,/u=new cn\(this.manager\)/);assert.match(textureLoader,/u\.load\(A/);assert.doesNotMatch(textureLoader,/fetch\(/);
  const bitmapLoader=html.slice(html.indexOf('class Nn extends pC'),html.indexOf('class Kn extends'));
  assert.match(bitmapLoader,/fetch\(A,Q\)/);assert.match(bitmapLoader,/createImageBitmap\(o/);
});
test('existing proxy CSP permits local blob images while refusing connect fetch, and keeps opaque sandbox',()=>{
  const proxy=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/mcp-app-proxy.html'),'utf8');
  assert.match(proxy,/var imgSources = "data: blob:"/);assert.match(proxy,/connect-src 'none'/);assert.match(proxy,/inner\.setAttribute\("sandbox", "allow-scripts"\)/);assert.doesNotMatch(proxy,/inner\.setAttribute\("sandbox", "allow-scripts allow-same-origin"\)/);
});
