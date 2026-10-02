const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const name of ['canvas-data.js', 'editor-data.js', 'sidebar-data.js', 'versions-data.js']) {
  try {
    fs.copyFileSync(path.join(root, 'defaults', name), path.join(root, name), fs.constants.COPYFILE_EXCL);
    console.log(`Initialized ${name}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`Preserved existing ${name}`);
  }
}
require('../src/features/local-resource-migration/cli.cjs').writeLocalResourceIndex({root}).then(result=>{
  if(!result.published)throw Error('Local resource mapping verification failed');
  console.log(`Local resource index ready: ${Object.keys(result.index.entries).length} verified mappings`);
}).catch(()=>{console.error('Local resource index unavailable; existing project data was preserved. Check local mapping manifests before restarting.');process.exitCode=1;});
