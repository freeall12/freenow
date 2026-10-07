'use strict';
module.exports = {
  appId: 'org.freenow.desktop',
  productName: 'freenow',
  directories: {app: 'desktop', output: 'build/release'},
  files: ['main.cjs', 'runtime-config.cjs', 'package.json'],
  extraResources: [{from: 'build/desktop/runtime', to: 'runtime'}],
  asar: true,
  npmRebuild: false,
  mac: {target: [{target: 'zip', arch: ['arm64']}], category: 'public.app-category.graphics-design', identity: null, icon: 'assets/branding/freenow-desktop.png'},
  artifactName: 'freenow-${version}-${os}-${arch}.${ext}',
  publish: null,
};
