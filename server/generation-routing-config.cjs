'use strict';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const envName=/^[A-Za-z_][A-Za-z0-9_]*$/;

// Routing is opt-in. Invalid routing must never fall through to a legacy key
// or endpoint: that could submit a paid request to an unintended service.
function readGenerationRoutingConfig(env=process.env){
 if(env.GENERATION_PROVIDERS===undefined&&env.GENERATION_ROUTES===undefined)return undefined;
 try{
  const providers=JSON.parse(env.GENERATION_PROVIDERS),routes=JSON.parse(env.GENERATION_ROUTES);
  if(!object(providers)||!object(routes))throw Error();
  const resolved={};
  for(const [id,config]of Object.entries(providers)){
   if(!object(config)||Object.keys(config).some(key=>!['protocol','apiKeyEnv','baseUrl','baseUrlEnv','modelMap','modelMapEnv'].includes(key)))throw Error();
   const get=key=>{
    const ref=config[key];if(ref===undefined)return undefined;
    if(typeof ref!=='string'||!envName.test(ref))throw Error();
    const value=own(env,ref)?env[ref]:undefined;
    if(value!==undefined&&typeof value!=='string')throw Error();
    return value;
   };
   if(own(config,'baseUrl')&&own(config,'baseUrlEnv')||own(config,'modelMap')&&own(config,'modelMapEnv'))throw Error();
   resolved[id]={protocol:config.protocol,apiKey:get('apiKeyEnv')||'',baseUrl:own(config,'baseUrl')?config.baseUrl:get('baseUrlEnv')||'',modelMap:own(config,'modelMap')?config.modelMap:get('modelMapEnv')};
  }
  return {providers:resolved,routes};
 }catch{return {providers:null,routes:null};}
}
module.exports={readGenerationRoutingConfig};
