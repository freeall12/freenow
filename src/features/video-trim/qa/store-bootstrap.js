(() => {
 const load=window.CanvasStore.load.bind(window.CanvasStore);
 window.CanvasStore.load=async(...args)=>{await window.VideoTrimFixture.seedReady;return load(...args);};
})();
