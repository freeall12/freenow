const test=require('node:test'),assert=require('node:assert/strict');
const {readGenerationRoutingConfig:read}=require('../server/generation-routing-config.cjs');
const config=value=>({GENERATION_PROVIDERS:JSON.stringify(value),GENERATION_ROUTES:'{"image.generate":"image"}'});
test('routing remains opt-in and resolves only explicit server environment references',()=>{
 assert.equal(read({GENERATION_API_KEY:'legacy'}),undefined);
 const result=read({...config({image:{protocol:'openai-native',apiKeyEnv:'IMAGE_KEY',baseUrlEnv:'IMAGE_URL',modelMapEnv:'IMAGE_MAP'}}),IMAGE_KEY:'test-private-key',IMAGE_URL:'https://example.test/v1',IMAGE_MAP:'{}'});
 assert.deepEqual(result,{providers:{image:{protocol:'openai-native',apiKey:'test-private-key',baseUrl:'https://example.test/v1',modelMap:'{}'}},routes:{'image.generate':'image'}});
 assert.equal(read(config({image:{protocol:'tasks-v1',apiKeyEnv:'MISSING'}})).providers.image.apiKey,'');
});
test('routing rejects malformed or ambiguous config and never leaks parsing data',()=>{
 const bad={providers:null,routes:null};
 for(const env of [{GENERATION_ROUTES:'{}'},{GENERATION_PROVIDERS:'{}'}, {GENERATION_PROVIDERS:'',GENERATION_ROUTES:'{}'},config([]),config({image:{apiKey:'do-not-expose'}}),config({image:{apiKeyEnv:'INVALID-NAME'}}),config({image:{baseUrl:'',baseUrlEnv:'URL'}}),config({image:{modelMap:{},modelMapEnv:'MAP'}}),config({image:{client:{}}})])assert.deepEqual(read(env),bad);
 assert.deepEqual(read({...config({image:{apiKeyEnv:'KEY'}}),KEY:{secret:'x'}}),bad);
});
