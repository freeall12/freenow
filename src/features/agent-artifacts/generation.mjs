export function createArtifactGeneration({ store, getAdapter }) {
  const jobs = new Map(), listeners = new Set();
  const notify = path => { for (const listener of listeners) { try { listener(path); } catch (error) { console.error(error); } } };
  return {
    get: path => jobs.get(path),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async generate(file) {
      const path = file.artifact_path;
      if (jobs.get(path)?.status === 'generating') return;
      const snapshot = structuredClone(file), controller = new AbortController();
      const job = { status: 'generating', sourceRevision: file.revision, startedAt: Date.now(), controller };
      jobs.set(path, job); notify(path);
      try {
        const adapter = getAdapter();
        if (typeof adapter !== 'function') throw Object.assign(Error('互动作品生成接口未配置'), { code: 'configuration_required' });
        const result = await adapter({ source: snapshot, signal: controller.signal });
        if (jobs.get(path) !== job || controller.signal.aborted) return;
        if (!result || typeof result.html !== 'string' || !result.html.trim()) throw Error('生成服务没有返回 HTML 作品');
        if (result.artifact_path === path) throw Error('生成作品不能覆盖 Brainstorm 原稿');
        // Saving a late result preserves its source revision; it never overwrites the source document.
        const output = await store.write({ artifact_path: result.artifact_path || 'artifacts/interactive-' + crypto.randomUUID() + '.html', title: result.title || snapshot.title || '互动作品', content_type: 'html', content: result.html, expected_revision: 0, source_artifact_path: path, source_revision: snapshot.revision });
        Object.assign(job, { status: 'ready', output }); notify(path);
      } catch (error) {
        if (jobs.get(path) !== job) return;
        Object.assign(job, { status: 'failed', error: error.message, code: error.code }); notify(path);
      }
    },
  };
}
