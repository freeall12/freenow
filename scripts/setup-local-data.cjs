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
