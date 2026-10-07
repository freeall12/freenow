const output = document.getElementById('state'), api = window.FreenowDesktopFiles;
let plan, operationId;
const buttons = [...document.querySelectorAll('button')];
function show(value) {output.textContent = JSON.stringify(value, null, 2);}
async function run(action) {
  for (const b of buttons) b.disabled = true;
  try {if (!api) throw Error('请用开发 Electron QA 入口打开本页。'); await action();}
  catch (error) {show({error: error.message});}
  finally {for (const b of buttons) b.disabled = false; document.getElementById('apply').disabled = !plan; document.getElementById('recover').disabled = !plan;}
}
document.getElementById('authorize').onclick = () => run(async () => show(await api.invoke('authorize', {})));
document.getElementById('status').onclick = () => run(async () => show(await api.invoke('status', {})));
document.getElementById('list').onclick = () => run(async () => show(await api.invoke('list', {path: ''})));
document.getElementById('revoke').onclick = () => run(async () => show(await api.invoke('revoke', {})));
document.getElementById('ops').oninput = () => {plan = null; operationId = null; document.getElementById('apply').disabled = true; document.getElementById('recover').disabled = true;};
document.getElementById('preview').onclick = () => run(async () => {operationId ||= crypto.randomUUID(); plan = await api.invoke('preview', {operationId, operations: JSON.parse(document.getElementById('ops').value)}); show(plan);});
document.getElementById('apply').onclick = () => run(async () => show(await api.invoke('apply', {batchId: plan.batchId, digest: plan.digest})));
document.getElementById('recover').onclick = () => run(async () => show(await api.invoke('recover', {batchId: plan.batchId})));
if (api) run(async () => {const value = await api.invoke('qa-location', {}); document.getElementById('folder').textContent = '本次临时目录：' + value.qaFolder;});
