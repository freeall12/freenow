(() => {
  const fixture=window.CanvasDuplicateFixture,load=window.CanvasStore.load.bind(window.CanvasStore),save=window.CanvasStore.save.bind(window.CanvasStore);
  window.CanvasStore.load=async(...args)=>{await fixture.seedReady;return load(...args);};
  window.CanvasStore.save=(value,...args)=>{fixture.saves.push(structuredClone(value));const pending=save(value,...args);pending.then(()=>{fixture.completedSaves++;fixture.report?.();},()=>fixture.report?.());return pending;};
})();
