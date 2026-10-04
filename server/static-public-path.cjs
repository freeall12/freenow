'use strict';

// Git ignore rules do not protect local captures from the HTTP file server.
function isPublicStaticPath(relative){
 if(typeof relative!=='string'||!relative||relative.includes('\\'))return false;
 const parts=relative.split('/'),root=parts[0].toLowerCase();
 if(parts.some(part=>part==='..'||part.startsWith('.')))return false;
 if(['server','tests','scripts'].includes(root))return false;
 if(root==='reference')return relative==='reference/TABLER-LICENSE';
 if(root==='node_modules')return relative.startsWith('node_modules/three/');
 if(/\.(?:har|pem|key|p12|pfx|bak|tmp)$/i.test(relative))return false;
 return true;
}
module.exports={isPublicStaticPath};
