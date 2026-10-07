'use strict';
module.exports = {
  appId: 'org.freenow.desktop',
  productName: 'freenow',
  directories: {app: 'desktop', output: 'build/release'},
  // Runtime modules are independently inventoried below. Do not duplicate
  // the workspace's frontend dependencies in ASAR via pnpm's collector.
  files: ['main.cjs', 'runtime-config.cjs', 'package.json', '!node_modules{,/**/*}'],
  // electron-builder filters a FileSet's root node_modules directory. Copy
  // each allowlisted module from its own root so the loopback server and
  // browser import map resolve the same runtime files as development.
  extraResources: [
    {from: 'build/desktop/runtime', to: 'runtime'},
    ...['openai', 'three'].map(name => ({from: `build/desktop/runtime/node_modules/${name}`, to: `runtime/node_modules/${name}`})),
  ],
  asar: true,
  npmRebuild: false,
  mac: {target: [{target: 'zip', arch: ['arm64']}], category: 'public.app-category.graphics-design', identity: null, icon: 'assets/branding/freenow-desktop.png'},
  artifactName: 'freenow-${version}-${os}-${arch}.${ext}',
  publish: null,
};
