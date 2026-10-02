'use strict';

// Stable entry point for the canvas logic that has no DOM mount requirement.
module.exports = Object.freeze({
  geometry: require('../canvas-geometry.js'),
  navigation: require('../canvas-navigation.js'),
  search: require('../src/features/canvas-search/core.js'),
  groups: require('../canvas-groups.js'),
  piles: require('../canvas-piles.js'),
  playlist: require('../canvas-playlist.js'),
  templates: require('../templates-core.js'),
  workflow: require('../workflow-core.js'),
  audio: require('../audio-core.js')
});
