(() => {
  const load=window.CanvasStore.load.bind(window.CanvasStore);
  window.CanvasStore.load=async(...args)=>{await window.PanoramaNativeFixture.seedReady;return load(...args);};
})();
