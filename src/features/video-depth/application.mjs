// Browser decoders supply these measurements. Provider metadata alone cannot
// prove that a tasks-v1 result preserved the complete source video.
export function assertDepthResultCount(request, outputs) {
  const count = request.parameters?.count ?? request.parameters?.times ?? request.count ?? 1;
  if (![1, 2].includes(count) || !Array.isArray(outputs) || outputs.length !== count || outputs.some(output => output.type !== 'video')) {
    throw Error('深度结果数量或类型与请求不一致，未写入画布');
  }
}

export function assertDepthResultGeometry(request, output) {
  const source = request.inputs?.[0];
  if (!source || !Number.isFinite(source.duration) || !Number.isFinite(output.duration) ||
      output.duration <= 0 || Math.abs(source.duration - output.duration) > .1 ||
      !Number.isInteger(source.width) || source.width <= 0 || !Number.isInteger(source.height) || source.height <= 0 ||
      output.width !== source.width || output.height !== source.height) {
    throw Error('深度结果未保留来源视频的实际尺寸或时长，未写入画布');
  }
}

const signature = node => JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key]) => !['x', 'y', 'selected'].includes(key))));

export function assertDepthApplicationCurrent(app, receipt) {
  if (app.projectIdentity().id !== receipt.projectId) throw Error('深度结果所属画布已切换，未应用旧结果');
  const nodes = app.getState().nodes;
  for (const result of receipt.results || []) {
    if (!nodes.includes(result.node) || signature(result.node) !== result.signature) throw Error('深度结果已修改或移除，未重复写入');
  }
}

export async function persistDepthApplication(app, store, job, receipt) {
  assertDepthApplicationCurrent(app, receipt);
  if (!Array.isArray(job.resultIds) || !job.resultIds.length) throw Error('深度结果尚未应用');
  if (!receipt.results) {
    receipt.results = job.resultIds.map(id => {
      const node = app.getState().nodes.find(value => value.id === id);
      if (!node || node.type !== 'video') throw Error('深度结果节点不完整，未重复创建');
      return {node, signature: signature(node)};
    });
  }
  assertDepthApplicationCurrent(app, receipt);
  const state = app.getState();
  await store.save({version: 1, nodes: state.nodes, edges: state.edges}, receipt.projectId, {
    beforeCommit() {assertDepthApplicationCurrent(app, receipt); return true;},
  });
  await store.flush();
  assertDepthApplicationCurrent(app, receipt);
}
