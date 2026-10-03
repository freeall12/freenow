(() => {
  'use strict';
  const load=window.CanvasStore.load.bind(window.CanvasStore);
  window.CanvasStore.load=async(...args)=>{await window.CanvasLayoutFixture.seedReady;return load(...args);};
})();
