const actions = {desktop_files_status: '查看文件夹授权', desktop_files_authorize: '选择并授权本地文件夹', desktop_files_list: '读取授权文件夹列表', desktop_files_preview: '预览文件整理批次', desktop_files_apply: '确认并整理本地文件夹', desktop_files_recover: '核对原文件操作批次'};
const statuses = {prepared: '等待整批确认', applying: '正在执行', completed: '整批完成', cancelled: '已取消，未执行', revoked: '授权已撤销', rolled_back: '执行失败，已撤回本批更改', rollback_failed: '部分更改未撤回，请检查回执', recovery_required: '原结果未知，仅可核对'};
export function desktopFilesPresentation(trace) {
  const result = trace.result || {}, args = trace.args || {}, action = actions[trace.name] || '本地文件夹操作';
  const operations = result.operations || args.operations;
  const lines = [result.displayPath, result.batchId ? '批次：' + result.batchId : args.batchId ? '批次：' + args.batchId : null, result.reason ? '原因：' + result.reason : null].filter(Boolean);
  if (operations) lines.push(...operations.map((a, i) => `${i + 1}. ${a.type === 'mkdir' ? '创建文件夹：' + a.path : (a.type === 'rename' ? '重命名：' : '移动：') + a.source + ' → ' + a.destination}`));
  if (result.rollbackErrors?.length) lines.push('未撤回操作：' + JSON.stringify(result.rollbackErrors));
  if (result.authorized === false) lines.push(result.message || '尚未授权目录。');
  return {label: action + (result.status ? ' · ' + (statuses[result.status] || result.status) : result.error ? ' · ' + result.error : ''), action, detail: lines.join('\n'), icon: 'tool'};
}
