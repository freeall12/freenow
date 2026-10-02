'use strict';
const http=require('node:http'),https=require('node:https'),net=require('node:net'),dns=require('node:dns/promises'),{createGunzip}=require('node:zlib');
const MiB=1024*1024;
const DEFAULT_LIMITS=Object.freeze({image:100*MiB,video:100*MiB,audio:50*MiB,glb:12*MiB,spz:256*MiB,source:100*MiB});
const BLOCKED=['tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'];
const fail=code=>Object.assign(Error('生成素材无法安全下载或校验'),{code});
const check=signal=>{if(signal?.aborted)throw fail(signal.reason?.name==='TimeoutError'?'media_download_timeout':'media_cancelled');};
function publicAddress(address){
 if(typeof address!=='string')return false;const family=net.isIP(address);if(family===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
 if(family!==6||address.includes('%')||address.includes('.'))return false;
 const halves=address.toLowerCase().split('::');if(halves.length>2)return false;const left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[];
 const fields=halves.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
 const bits=fields.reduce((v,n)=>(v<<16n)|BigInt('0x'+n),0n);
 const inRange=(prefix,size)=>(bits>>BigInt(128-size))===(BigInt(prefix)>>BigInt(128-size));
 // Global unicast only; reject transition, benchmark, documentation and ORCHID ranges.
 return inRange('0x20000000000000000000000000000000',3)&&!inRange('0x20010000000000000000000000000000',23)&&!inRange('0x20010db8000000000000000000000000',32)&&!inRange('0x20020000000000000000000000000000',16)&&!inRange('0x3fff0000000000000000000000000000',20);
}
function publicMediaUrl(value){
 if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f\\]/.test(value))throw fail('media_url_forbidden');
 let url;try{url=new URL(value);}catch{throw fail('media_url_forbidden');}
 const host=url.hostname.toLowerCase().replace(/\.$/,'').replace(/^\[|\]$/g,'');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||BLOCKED.some(domain=>host===domain||host.endsWith('.'+domain))||net.isIP(host)&&!publicAddress(host))throw fail('media_url_forbidden');
 url.hash='';return url;
}
function addressIdentity(value){
 if(typeof value!=='string')return null;if(net.isIP(value)===4)return '4:'+value;if(net.isIP(value)!==6)return null;
 const [left,right]=value.toLowerCase().split('::'),a=left?left.split(':'):[],b=right?right.split(':'):[];
 const mapped=piece=>piece.includes('.')?piece.split('.').reduce((number,item)=>(number<<8)|Number(item),0)>>>0:null;
 const last=(right??left).split(':').at(-1);if(last.includes('.')){const number=mapped(last),replacement=[(number>>>16).toString(16),(number&65535).toString(16)];const target=right!==undefined?b:a;target.splice(-1,1,...replacement);}
 const groups=right!==undefined?[...a,...Array(8-a.length-b.length).fill('0'),...b]:a;
 const bits=groups.reduce((number,piece)=>(number<<16n)|BigInt('0x'+piece),0n);
 if(bits>>32n===65535n){const ipv4=Number(bits&0xffffffffn);return '4:'+[(ipv4>>>24)&255,(ipv4>>>16)&255,(ipv4>>>8)&255,ipv4&255].join('.');}return '6:'+bits.toString(16);
}
const equalAddress=(a,b)=>{const left=addressIdentity(a);return left!==null&&left===addressIdentity(b);};
function sniff(bytes,kind){
 let actual;
 if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>32768||height>32768||width*height>100000000)throw fail('media_dimensions_invalid');actual={mime:'image/png',format:'png'};
 }else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)actual={mime:'image/jpeg',format:'jpeg'};
 else if(bytes.length>=10&&/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))actual={mime:'image/gif',format:'gif'};
 else if(bytes.length>=16&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')actual={mime:'image/webp',format:'webp'};
 else if(bytes.length>=16&&bytes.toString('ascii',4,8)==='ftyp'){
  const brand=bytes.toString('ascii',8,12);actual=/avif|avis/.test(brand)?{mime:'image/avif',format:'avif'}:kind==='audio'?{mime:'audio/mp4',format:'m4a'}:{mime:'video/mp4',format:'mp4'};
 }else if(bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])))actual={mime:kind==='audio'?'audio/webm':'video/webm',format:'webm'};
 else if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE')actual={mime:'audio/wav',format:'wav'};
 else if(bytes.length>=4&&bytes.toString('ascii',0,4)==='OggS')actual={mime:'audio/ogg',format:'ogg'};
 else if(bytes.length>=4&&bytes.toString('ascii',0,4)==='fLaC')actual={mime:'audio/flac',format:'flac'};
 else if(bytes.length>=4&&(bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&0xe0)===0xe0&&(bytes[1]&0x06)!==0))actual={mime:'audio/mpeg',format:'mp3'};
 else if(bytes.length>=4&&bytes[0]===255&&(bytes[1]&0xf6)===0xf0)actual={mime:'audio/aac',format:'aac'};
 else if(bytes.length>=20&&bytes.toString('ascii',0,4)==='glTF'&&bytes.readUInt32LE(4)===2&&bytes.readUInt32LE(8)>=20)actual={mime:'model/gltf-binary',format:'glb'};
 else if(bytes.length>=4&&bytes[0]===31&&bytes[1]===139&&bytes[2]===8&&kind==='spz')actual={mime:'application/octet-stream',format:'spz'};
 if(!actual||kind!=='source'&&!(kind==='glb'||kind==='spz'?actual.format===kind:actual.mime.startsWith(kind+'/')))throw fail('media_format_invalid');
 return actual;
}
function mimeCompatible(reported,actual){
 if(!reported||['application/octet-stream','binary/octet-stream','application/binary'].includes(reported))return true;
 const aliases={'image/jpg':'image/jpeg','audio/mp3':'audio/mpeg','audio/x-wav':'audio/wav','audio/wave':'audio/wav','video/quicktime':'video/mp4','application/gzip':'application/octet-stream','application/x-gzip':'application/octet-stream','application/x-spz':'application/octet-stream','model/spz':'application/octet-stream','audio/x-m4a':'audio/mp4','audio/x-flac':'audio/flac'};
 return (aliases[reported]||reported)===actual.mime;
}
// RIFF uses an unknown-length sentinel in the existing OpenAI streaming WAV
// contract. Validate chunk boundaries from actual bytes rather than rejecting
// a valid stream merely because its header cannot know the final length.
function waveValidator(){
 let pending=Buffer.alloc(0),skip=12,header=true,current=null,remaining=0,padding=0,format=null,dataBytes=0,dataSeen=false,chunks=0;
 function push(chunk){let offset=0;
  while(offset<chunk.length){
   if(skip){const take=Math.min(skip,chunk.length-offset);skip-=take;offset+=take;continue;}
   if(padding){padding=0;offset++;continue;}
   if(header){const take=Math.min(8-pending.length,chunk.length-offset);pending=Buffer.concat([pending,chunk.subarray(offset,offset+take)]);offset+=take;if(pending.length<8)continue;
    if(++chunks>4096)throw fail('media_format_invalid');const type=pending.toString('ascii',0,4),declared=pending.readUInt32LE(4);pending=Buffer.alloc(0);
    if(type==='fmt '&&format||type==='data'&&dataSeen||declared===0xffffffff&&type!=='data')throw fail('media_format_invalid');
    if(type==='data')dataSeen=true;current={type,declared,read:0,prefix:Buffer.alloc(0)};remaining=declared===0xffffffff?Infinity:declared;header=false;if(!remaining)finishChunk();continue;
   }
   const take=Math.min(remaining,chunk.length-offset),bytes=chunk.subarray(offset,offset+take);offset+=take;remaining-=take;current.read+=take;
   if(current.type==='fmt '&&current.prefix.length<16)current.prefix=Buffer.concat([current.prefix,bytes]).subarray(0,16);
   if(current.type==='data')dataBytes+=take;if(!remaining)finishChunk();
  }
 }
 function finishChunk(){if(current.type==='fmt '){const f=current.prefix;if(f.length<16)throw fail('media_format_invalid');format={codec:f.readUInt16LE(0),channels:f.readUInt16LE(2),sampleRate:f.readUInt32LE(4),byteRate:f.readUInt32LE(8),alignment:f.readUInt16LE(12),bits:f.readUInt16LE(14)};if(!format.codec||!format.channels||format.channels>32||format.sampleRate<1000||format.sampleRate>384000||!format.byteRate||!format.alignment||format.alignment>1024||format.bits>64)throw fail('media_format_invalid');}
  padding=current.declared%2;current=null;header=true;
 }
 function finish(){if(skip||pending.length||padding||!header&&!(current?.type==='data'&&remaining===Infinity)||!format||!dataBytes||[1,3].includes(format.codec)&&dataBytes%format.alignment)throw fail('media_format_invalid');}
 return {push,finish};
}
async function bounded(operation,signal){
 check(signal);let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(fail(signal?.reason?.name==='TimeoutError'?'media_download_timeout':'media_cancelled'));signal?.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([Promise.resolve().then(operation),stopped]);}finally{signal?.removeEventListener('abort',abort);}
}
function safeHeaders(value){
 if(value===undefined)return {};if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length>24)throw fail('media_resolver_invalid');
 const headers={};let total=0;for(const [key,v]of Object.entries(value)){
  if(!/^[A-Za-z0-9-]{1,80}$/.test(key)||['host','connection','content-length','transfer-encoding','accept-encoding','proxy-authorization','cookie','set-cookie','upgrade','te','trailer'].includes(key.toLowerCase())||typeof v!=='string'||/[\x00-\x1f\x7f]/.test(v)||(total+=key.length+v.length)>16384)throw fail('media_resolver_invalid');headers[key]=v;
 }return headers;
}
function createGenerationMediaDownloader({lookup=(host,options)=>dns.lookup(host,options),requestImpl,timeoutMs=120000,limits={}}={}){
 const budgets={...DEFAULT_LIMITS,...limits};if(typeof lookup!=='function'||requestImpl!==undefined&&typeof requestImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000||Object.entries(budgets).some(([key,value])=>!Object.hasOwn(DEFAULT_LIMITS,key)||!Number.isSafeInteger(value)||value<1||value>DEFAULT_LIMITS[key]))throw fail('media_invalid_input');
 async function download(resource,{kind,signal,onBytes=()=>{}}={}){
  if(!Object.hasOwn(budgets,kind)||typeof onBytes!=='function')throw fail('media_invalid_input');
  const descriptor=typeof resource==='string'?{url:resource}:resource;if(!descriptor||typeof descriptor.url!=='string')throw fail('media_invalid_input');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);let response,request,closed=false;
  const close=()=>{if(closed)return;closed=true;response?.destroy();request?.destroy();};
  const abort=()=>close();combined.addEventListener('abort',abort,{once:true});
  const cleanup=()=>{combined.removeEventListener('abort',abort);close();};
  try{
   check(combined);let source,reported,expectedBytes;
   if(descriptor.url.startsWith('data:')){
    if(descriptor.headers!==undefined||descriptor.origin!==undefined)throw fail('media_resolver_invalid');
    const max=budgets[kind],match=/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(descriptor.url);
    if(!match||match[2].length>Math.ceil(max/3)*4||match[2].length%4!==0)throw fail('media_data_invalid');
    const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.toString('base64')!==match[2]||bytes.length>max)throw fail('media_data_invalid');reported=match[1];expectedBytes=bytes.length;source=(async function*(){for(let offset=0;offset<bytes.length;offset+=65536)yield bytes.subarray(offset,offset+65536);})();
   }else{
    const url=publicMediaUrl(descriptor.url),headers=safeHeaders(descriptor.headers);
    // Only a server resolver may attach headers, and its declaration binds them
    // to this exact resource origin. No provider key is attached by default.
    if(Object.keys(headers).length&&(descriptor.origin!==url.origin))throw fail('media_resolver_invalid');
    const host=url.hostname.replace(/^\[|\]$/g,'');let addresses;
    if(net.isIP(host))addresses=[{address:host,family:net.isIP(host)}];else addresses=await bounded(()=>lookup(host,{all:true,verbatim:true}),combined);
    if(!Array.isArray(addresses)||!addresses.length||addresses.length>64||addresses.some(v=>!v||!publicAddress(v.address)||v.family!==net.isIP(v.address)))throw fail('media_dns_forbidden');
    const selected=addresses[0],pinned=(_hostname,options,callback)=>{if(typeof options==='function'){callback=options;options={};}callback(null,...options?.all?[[selected]]:[selected.address,selected.family]);};
    response=await bounded(()=>new Promise((resolve,reject)=>{
     const transport=requestImpl||(url.protocol==='https:'?https.request:http.request);
     request=transport(url,{method:'GET',agent:false,lookup:pinned,family:selected.family,maxHeaderSize:16384,headers:{...headers,'Accept-Encoding':'identity'},signal:combined},resolve);
     request.on('error',()=>reject(fail(combined.aborted?'media_cancelled':'media_download_failed')));request.end();
    }),combined);
    if(!equalAddress(response.socket?.remoteAddress,selected.address))throw fail('media_connection_forbidden');
    if(response.statusCode>=300&&response.statusCode<400)throw fail('media_redirect_forbidden');if(response.statusCode!==200)throw fail(response.statusCode===403?'media_download_expired':response.statusCode===404?'media_download_not_found':'media_download_http_error');
    const encoding=response.headers['content-encoding'];if(encoding&&encoding!=='identity')throw fail('media_encoding_invalid');
    const length=response.headers['content-length'];if(length!==undefined){if(typeof length!=='string'||!/^\d{1,12}$/.test(length)||!(expectedBytes=Number(length)))throw fail('media_length_mismatch');if(expectedBytes>budgets[kind])throw fail('media_too_large');}
    const contentType=response.headers['content-type'];if(contentType!==undefined&&(typeof contentType!=='string'||contentType.length>200))throw fail('media_format_invalid');reported=contentType?.split(';')[0].trim().toLowerCase();source=response;
   }
   const iterator=source[Symbol.asyncIterator](),first=[];let firstBytes=0;
   while(firstBytes<64){const next=await bounded(()=>iterator.next(),combined);if(next.done)break;if(!(next.value instanceof Uint8Array))throw fail('media_format_invalid');first.push(Buffer.from(next.value));firstBytes+=next.value.byteLength;if(firstBytes>budgets[kind])throw fail('media_too_large');}
   const prefix=Buffer.concat(first),actual=sniff(prefix,kind==='source'&&reported?.startsWith('audio/')?'audio':kind);if(!mimeCompatible(reported,actual))throw fail('media_mime_mismatch');const maxBytes=Math.min(budgets[kind],budgets[actual.format]??budgets[actual.mime.split('/')[0]]??budgets[kind]);
   async function* stream(){
    let total=0,tail=Buffer.alloc(0),completed=false,gunzip,expanded,spzDone;const wave=actual.format==='wav'?waveValidator():null;
    try{
     if(actual.format==='spz'){
      gunzip=createGunzip();expanded={bytes:0,prefix:Buffer.alloc(0)};
      spzDone=(async()=>{for await(const chunk of gunzip){expanded.bytes+=chunk.length;if(expanded.bytes>1024*MiB)throw fail('media_spz_expansion_limit');if(expanded.prefix.length<16)expanded.prefix=Buffer.concat([expanded.prefix,chunk]).subarray(0,16);}})();spzDone.catch(()=>gunzip.destroy());
     }
     const take=async chunk=>{check(combined);total+=chunk.length;if(total>maxBytes)throw fail('media_too_large');onBytes(chunk.length);wave?.push(chunk);tail=Buffer.concat([tail,chunk]).subarray(-16);if(gunzip){await bounded(()=>new Promise((resolve,reject)=>gunzip.write(chunk,error=>error?reject(fail('media_format_invalid')):resolve())),combined);}};
     for(const chunk of first){await take(chunk);yield chunk;}
     for(;;){const next=await bounded(()=>iterator.next(),combined);if(next.done)break;const chunk=Buffer.from(next.value);await take(chunk);yield chunk;}
     if(!total||expectedBytes!==undefined&&total!==expectedBytes)throw fail('media_length_mismatch');
     if(actual.format==='glb'&&prefix.readUInt32LE(8)!==total||actual.format==='webp'&&prefix.readUInt32LE(4)+8!==total||actual.format==='wav'&&prefix.readUInt32LE(4)!==0xffffffff&&prefix.readUInt32LE(4)+8!==total)throw fail('media_length_mismatch');
     wave?.finish();
     if(actual.format==='png'&&!tail.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130]))||actual.format==='jpeg'&&!tail.subarray(-2).equals(Buffer.from([255,217])))throw fail('media_format_invalid');
     if(gunzip){gunzip.end();await bounded(()=>spzDone,combined);const h=expanded.prefix;if(h.length<16||h.toString('ascii',0,4)!=='NGSP'||h.readUInt32LE(4)<1||h.readUInt32LE(4)>3||!h.readUInt32LE(8)||h[12]>3||h[13]>24)throw fail('media_format_invalid');const version=h.readUInt32LE(4),degree=h[12],expected=16+h.readUInt32LE(8)*((version===1?6:9)+3+(version>=3?4:3)+1+3+degree*(degree+2)*3);if(h[14]&~3||h[15]!==0||expanded.bytes<expected||!(h[14]&2)&&expanded.bytes!==expected)throw fail('media_format_invalid');}
     check(combined);completed=true;
    }catch(error){throw error.code?.startsWith('media_')?error:fail('media_format_invalid');}
    finally{gunzip?.destroy();cleanup();if(!completed)try{void Promise.resolve(iterator.return?.()).catch(()=>{});}catch{}}
   }
   return {...actual,maxBytes,expectedBytes,stream:stream(),close:cleanup};
  }catch(error){cleanup();throw error.code?.startsWith('media_')?error:fail('media_download_failed');}
 }
 return {download};
}
module.exports={createGenerationMediaDownloader,publicMediaUrl,publicAddress,DEFAULT_LIMITS,resourceMimeCompatible:mimeCompatible};
