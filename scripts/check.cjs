const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function modules(directory){return fs.existsSync(path.join(root,directory))?fs.readdirSync(path.join(root,directory),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?modules(path.join(directory,entry.name)):/\.(js|mjs|cjs)$/.test(entry.name)?[path.join(directory,entry.name)]:[]):[];}
const files=[...fs.readdirSync(root).filter(f=>/\.(js|mjs)$/.test(f)),...modules('server'),...modules('src')];
for(const f of files){const r=spawnSync(process.execPath,['--check',path.join(root,f)],{encoding:'utf8'});if(r.status){console.error(f+'\n'+r.stderr);process.exit(1);}}console.log('Syntax OK: '+files.length+' JavaScript modules');
