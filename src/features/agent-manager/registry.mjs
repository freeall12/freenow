import {appCatalog} from './catalog.mjs';
import {createAppRegistry} from './model.mjs';
let adapter=null;
export const appRegistry=createAppRegistry({storage:localStorage,adapter:()=>adapter,catalog:appCatalog});
export function configureAppAdapter(value){adapter=value;}
export function availableApps(){return appCatalog.filter(a=>{const s=appRegistry.state(a.id);return s.installed&&s.enabled;}).map(a=>({kind:'app',id:a.id,label:a.id==='brainstorm'?'头脑风暴':a.id,menuLabel:a.name,icon:a.icon,description:a.description}));}
