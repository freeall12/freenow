const test = require('node:test'), assert = require('node:assert/strict');
const moduleReady = import('../src/features/video-depth/application.mjs');

test('depth results require exact count and decoded source geometry before mutation', async () => {
  const {assertDepthResultCount, assertDepthResultGeometry} = await moduleReady;
  const request = {inputs: [{width: 64, height: 48, duration: 2}], parameters: {count: 2}};
  const output = {type: 'video', width: 64, height: 48, duration: 2};
  assertDepthResultCount(request, [output, output]); assertDepthResultGeometry(request, output);
  for (const outputs of [[], [output], [output, {...output, type: 'image'}]]) assert.throws(() => assertDepthResultCount(request, outputs), /数量或类型/);
  for (const patch of [{width: 48}, {height: 64}, {duration: 1}, {duration: NaN}, {width: undefined}]) assert.throws(() => assertDepthResultGeometry(request, {...output, ...patch}), /尺寸或时长/);
});

test('depth result save retries retain node identity and never accept edited, deleted or switched-project results', async () => {
  const {persistDepthApplication} = await moduleReady;
  for (const change of ['none', 'edit', 'delete', 'switch']) {
    const node = {id: 'result', type: 'video', video: 'asset:original', x: 0, y: 0}, state = {nodes: [node], edges: []};
    let projectId = 'project', saves = 0, flushes = 0;
    const app = {getState: () => state, projectIdentity: () => ({id: projectId})};
    const receipt = {projectId}, job = {resultIds: ['result']};
    const store = {save: async (snapshot, id, {beforeCommit}) => {assert.equal(id, 'project'); assert.equal(beforeCommit(), true); if (++saves === 1) throw Error('disk full');}, flush: async () => {flushes++;}};
    await assert.rejects(persistDepthApplication(app, store, job, receipt), /disk full/);
    node.x = 99; node.selected = true;
    if (change === 'edit') node.video = 'asset:changed';
    if (change === 'delete') state.nodes = [];
    if (change === 'switch') projectId = 'another';
    if (change === 'none') {await persistDepthApplication(app, store, job, receipt); assert.equal(saves, 2); assert.equal(flushes, 1);}
    else {await assert.rejects(persistDepthApplication(app, store, job, receipt), /修改|移除|切换/); assert.equal(saves, 1); assert.equal(flushes, 0);}
    assert.equal(job.resultIds[0], 'result');
  }
});

test('depth transaction checks project and result ownership at actual commit, not only when queuing a save', async () => {
  const {persistDepthApplication} = await moduleReady;
  const node = {id: 'result', type: 'video', video: 'asset:original'};
  let project = 'before', commits = 0;
  const app = {getState: () => ({nodes: [node], edges: []}), projectIdentity: () => ({id: project})};
  const store = {save: async (_state, _id, {beforeCommit}) => {await Promise.resolve(); project = 'after'; beforeCommit(); commits++;}, flush: () => assert.fail('must not flush rejected transaction')};
  await assert.rejects(persistDepthApplication(app, store, {resultIds: ['result']}, {projectId: project}), /切换/);
  assert.equal(commits, 0);
});

test('depth workflow keeps variants in history and plans two ordered spread/pile processing targets', async () => {
  const {createResultWorkflow, captureSubmission} = await import('../src/features/generation-results/workflow.mjs');
  const {prepareDepthTaskRequest} = await import('../src/features/agent-workflows/depth-video.mjs');
  for (const mode of ['variants', 'spread', 'pile']) for (const existing of [false, true]) {
    let state = {nodes: [{id: 'input', type: 'video', video: 'source.mp4', x: 0, y: 0, width: 100, height: 80}, {id: 'target', type: 'video', x: 200, y: 0, width: 100, height: 80, ...(existing ? {video: 'old.mp4'} : {})}], edges: [{id: 'edge', source: 'input', target: 'target'}]};
    let plan;
    const app = {getState: () => state, commitGenerationPlan: async value => {plan = value; state = {nodes: plan.nodes, edges: plan.edges};}, clearGenerationResults() {}, applyGenerationResults(_id, patches) {return patches.map(({id}) => id);}};
    const request = {kind: 'video.depth', nodeId: 'target', prompt: '', inputs: [{id: 'input', type: 'video', url: 'https://example.test/source.mp4', width: 64, height: 48, duration: 2}], parameters: {workflow: 'depth-video-studio', protocol: 'local-depth-v1', resolution: 'source', width: 64, height: 48, duration: 2, preserveDuration: true, promptUsed: false, count: 2, times: 2, resultMode: mode}};
    const workflow = createResultWorkflow(app), prepared = await workflow.prepare(request, {jobId: 'run', signal: new AbortController().signal}, captureSubmission(request, state, mode));
    prepareDepthTaskRequest(prepared);
    if (mode === 'variants') {assert.equal(plan, undefined); assert.equal(prepared, request); continue;}
    assert.equal(plan.targetNodeIds.length, 2); assert.equal(plan.requestPlans.length, 2); assert.equal(prepared.parameters.batch_count, 2);
    assert.equal(plan.preservesSourceNode, existing); assert.equal(plan.targetNodeIds.includes('target'), !existing);
    assert.ok(plan.pendingTargetNodes.every(node => node.pendingOperation === 'video.depth'));
    assert.equal(!!plan.pileNode, mode === 'pile');
    assert.deepEqual(await workflow.apply({id: 'run', request: prepared, outputs: [0, 1].map(i => ({type: 'video', video: 'output' + i, width: 64, height: 48, duration: 2}))}, async () => {}), plan.targetNodeIds);
  }
});

test('ordinary depth source guard catches upstream changes, edge changes and project switches while accepting owned target placeholders', () => {
  const fs = require('node:fs'), vm = require('node:vm'), source = fs.readFileSync(require.resolve('../generation-ui.js'), 'utf8');
  const code = source.slice(source.indexOf('  function captureDepthSourceGuard('), source.indexOf('  function submit(request,options)'));
  for (const change of ['source', 'target', 'edge', 'project', 'replace-source', 'owned-target']) {
    const input = {id: 'input', type: 'video', video: 'source.mp4'}, target = {id: 'target', type: 'video', generation: {count: 2}};
    const state = {nodes: [input, target], edges: [{id: 'edge', source: 'input', target: 'target'}]}; let project = 'p';
    const context = {app: {getState: () => state, projectIdentity: () => ({id: project})}, window: {NodeEditor: {getConfig: node => node.generation}}};
    vm.createContext(context); vm.runInContext(code, context);
    const guard = context.captureDepthSourceGuard({nodeId: 'target', inputs: [{id: 'input'}]}, state);
    input.x = 90; target.selected = true; guard();
    if (change === 'source') input.video = 'edited.mp4';
    if (change === 'target') target.generation.count = 1;
    if (change === 'edge') state.edges[0].order = 1;
    if (change === 'project') project = 'other';
    if (change === 'replace-source') state.nodes[0] = {...input};
    if (change === 'owned-target') {
      const next = {...target, generation: {count: 1}, pendingOperation: 'video.depth', generationRun: {runId: 'job'}}; state.nodes[1] = next;
      guard.acceptReplacements([{before: target, after: next}]); guard(); input.video = 'late.mp4';
    }
    assert.throws(guard, /变化/);
  }
});

test('depth recovery binds its project before asynchronously loading the placeholder workflow', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), source = fs.readFileSync(require.resolve('../generation-ui.js'), 'utf8');
  const code = source.slice(source.indexOf('  async function applyRecovered('), source.indexOf('  async function retryApplication('));
  let project = 'before', resolve, restored = 0, applied = 0;
  const job = {id: 'job', recovered: true, request: {kind: 'video.depth'}};
  const context = {service: {jobs: new Map([['job', job]])}, depthApplications: new Map(), app: {projectIdentity: () => ({id: project})}, resultModules: new Promise(ready => {resolve = ready;}), resultWorkflow: null, retryApplication: () => {applied++;}};
  vm.createContext(context); vm.runInContext(code, context);
  const pending = context.applyRecovered('job', 'existing'); project = 'after';
  resolve({createResultWorkflow: () => ({restore: () => {restored++;}})});
  await assert.rejects(pending, /画布已切换/); assert.equal(restored, 0); assert.equal(applied, 0); assert.equal(context.depthApplications.get('job').projectId, 'before');
});
