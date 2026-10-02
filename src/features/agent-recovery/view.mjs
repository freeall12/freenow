import {canCheck, describeRecovery, describeRecoveryReason} from './model.mjs';
import {resumeEligibility} from './journal.mjs';

export function createRecoveryView({record, scope, checking = false, disabled = false, onCheck, onResume, document = globalThis.document}) {
  const make = (tag, cls, text) => {const node = document.createElement(tag); node.className = cls; if (text !== undefined) node.textContent = text; return node;};
  const {label, detail, pendingCount} = describeRecovery(record);
  const row = make('section', 'agent-message agent-tool agent-recovery'); row.setAttribute('aria-label', '中断任务核对'); row.dataset.submissionId = record.submissionId || '';
  const heading = make('div', 'agent-recovery-heading'); heading.append(make('strong', '', label));
  const button = make('button', '', checking ? '正在核对…' : record.checkedAt ? '再次核对中断任务' : '核对中断任务');
  button.type = 'button'; button.disabled = checking || disabled || !canCheck(record, scope); button.onclick = onCheck; heading.append(button);
  row.append(heading, make('p', '', detail));
  if (onResume && record.state && !['completed', 'failed', 'cancelled'].includes(record.state.status)) {
    const eligibility = resumeEligibility(record, scope), resume = make('button', '', '继续中断任务');
    resume.type = 'button'; resume.setAttribute('aria-label', '继续中断任务'); resume.disabled = checking || disabled || !eligibility.allowed; resume.onclick = onResume;
    heading.append(resume); row.append(make('p', 'agent-recovery-resume-hint', eligibility.reason));
  }
  if (record.startedAt) row.append(make('small', '', '开始时间：' + new Date(record.startedAt).toLocaleString('zh-CN')));
  if (record.state) row.append(make('p', '', '待确认工具：' + pendingCount + (record.state.round === null ? '' : ' · 轮次：' + record.state.round)));
  if (record.state?.reason) {
    const reason = describeRecoveryReason(record.state.reason); row.append(make('p', 'agent-recovery-reason', reason.text));
    if (reason.diagnostic) {const details = make('details', ''); details.append(make('summary', '', '查看诊断信息'), make('pre', '', reason.diagnostic)); row.append(details);}
  }
  if (record.state?.delegation) {
    const tasks = record.state.delegation.tasks, titles = new Map(tasks.map(task => [task.taskId, task.title]));
    const labels = {not_started: '尚未启动', queued: '已排队', running: '执行中', waiting: '等待原工具回执', completed: '已完成',
      failed: '失败', cancelled: '已取消', limited: '达到上限', skipped: '已跳过', unknown: '执行结果未知', blocked: '等待依赖或恢复受阻'};
    const details = make('details', 'agent-recovery-delegation');
    details.append(make('summary', '', '子任务状态 · ' + tasks.length));
    details.append(make('p', '', '以下是本次核对读取的服务端记录，不会自动继续子任务或执行工具。'));
    const list = make('ol', 'agent-recovery-tasks');
    for (const task of tasks) {
      const item = make('li', 'agent-recovery-task'), heading = make('div', 'agent-recovery-task-heading');
      heading.append(make('strong', '', task.title), make('span', 'delegation-status', labels[task.status] || '状态待确认'));
      item.append(heading);
      if (task.dependsOn.length) item.append(make('p', '', '依赖：' + task.dependsOn.map(id => titles.get(id)).join('、')));
      if (task.blockedBy?.length) item.append(make('p', '', '受阻于：' + task.blockedBy.map(id => titles.get(id)).join('、')));
      if (task.error) {
        const diagnostic = /^[a-z][a-z0-9_]+$/.test(task.error) ? describeRecoveryReason(task.error) : {text: task.error};
        item.append(make('p', 'agent-recovery-error', diagnostic.text));
        if (diagnostic.diagnostic) {const info = make('details', ''); info.append(make('summary', '', '查看诊断信息'), make('pre', '', diagnostic.diagnostic)); item.append(info);}
      }
      list.append(item);
    }
    details.append(list); row.append(details);
  }
  if (record.readError) {const error = make('p', 'agent-recovery-error', '核对失败：' + record.readError + '。中断记录已保留，可再次核对。'); error.setAttribute('role', 'status'); row.append(error);}
  if (record.saveError) {const error = make('p', 'agent-recovery-error', '核对记录未能保存：' + record.saveError + '。当前显示仍可查看；关闭页面前请解决保存问题。'); error.setAttribute('role', 'status'); row.append(error);}
  if (record.resumeError) {const error = make('p', 'agent-recovery-error', '继续已暂停：' + record.resumeError); error.setAttribute('role', 'status'); row.append(error);}
  if (record.state?.text) {const details = make('details', ''); details.append(make('summary', '', '查看服务端返回文本'), make('pre', '', record.state.text)); row.append(details);}
  return row;
}
