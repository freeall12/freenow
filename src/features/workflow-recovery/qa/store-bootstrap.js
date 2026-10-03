(() => {
  'use strict';
  const load = window.CanvasStore.load.bind(window.CanvasStore);
  window.CanvasStore.load = async (...args) => {
    await window.WorkflowRecoveryFixture.canvasSeedReady;
    return load(...args);
  };
})();
