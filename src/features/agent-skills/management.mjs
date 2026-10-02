import {skillVersion} from '../agent-manager/skill-commit.mjs';

const skillsKey = 'tapnow-custom-skills', receiptsKey = 'tapnow-skill-commits-v1', disabledKey = 'tapnow-disabled-skills';
const fail = (code, message) => Object.assign(new Error(message), {code});
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(canonical(value))))), byte => byte.toString(16).padStart(2, '0')).join('');
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('技能管理已取消', 'AbortError'); };
function appliedFailure(error, result) {
  // Preserve cancellation as cancellation. Other failures after applying the
  // skill carry its actual result, without pretending the ledger was confirmed.
  if (error.name !== 'AbortError') {
    error.applied = true;
    error.receipt = {...result, applied: true, receiptConfirmed: false, currentMatches: true};
  }
  throw error;
}

function readArray(storage, key) {
  const value = JSON.parse(storage.getItem(key) || '[]');
  if (!Array.isArray(value)) throw fail('invalid_storage', '技能存储格式无效');
  return value;
}

function argumentsFor(action, input) {
  const keys = ['name', 'operation_id', 'base_version', ...(action === 'rename' ? ['new_name'] : [])];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key)))
    throw fail('invalid_arguments', '技能管理参数无效');
  for (const key of action === 'rename' ? ['name', 'new_name'] : ['name']) {
    if (typeof input[key] !== 'string' || !/^[a-z0-9-]{1,64}$/.test(input[key]))
      throw fail('invalid_name', '技能名称只允许小写字母、数字和连字符，最多64个字符');
  }
  if (typeof input.operation_id !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.operation_id))
    throw fail('invalid_operation_id', '技能管理 operation_id 无效');
  if (typeof input.base_version !== 'string' || !/^[a-f0-9]{64}$/.test(input.base_version))
    throw fail('invalid_version', '先读取当前个人技能版本，再管理技能');
  if (action === 'rename' && input.name === input.new_name)
    throw fail('invalid_name', '新技能名称必须与原名称不同');
  return {...input};
}

function renameEntry(content, name, description) {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '', source = content.slice(bom.length);
  const frontmatter = source.match(/^---[^\S\r\n]*(\r?\n)([\s\S]*?)(\r?\n)---(?:\r?\n|$)/);
  if (!frontmatter) return bom + '---\nname: ' + name + '\ndescription: ' + JSON.stringify(description || '') + '\n---\n' + source;
  const lineEnding = frontmatter[1];
  const metadata = /^name:[^\r\n]*$/m.test(frontmatter[2])
    ? frontmatter[2].replace(/^name:[^\r\n]*$/gm, 'name: ' + name)
    : 'name: ' + name + lineEnding + frontmatter[2];
  const header = frontmatter[0].replace(frontmatter[1] + frontmatter[2] + frontmatter[3], lineEnding + metadata + frontmatter[3]);
  return bom + header + source.slice(frontmatter[0].length);
}

let queued = Promise.resolve();
function withLock(run) {
  // Match the save/import manager's lock; snapshot checks also protect hosts
  // without Web Locks from another module changing the collection while hashing.
  const locked = () => globalThis.navigator?.locks?.request
    ? navigator.locks.request('tapnow-personal-skills', run) : run();
  const result = queued.then(locked, locked);
  queued = result.catch(() => {});
  return result;
}

async function currentResult(receipt, current, replayed) {
  const latest = current.find(skill => skill.name === (receipt.result.newName || receipt.result.oldName));
  const currentVersion = latest ? await skillVersion(latest) : null;
  const currentMatches = receipt.action === 'uninstall' ? !latest
    : currentVersion === receipt.result.version && !current.some(skill => skill.name === receipt.result.oldName);
  return {...receipt.result, replayed, currentVersion, currentMatches};
}

async function manage(action, input, {storage, builtinNames, signal}) {
  checkAbort(signal);
  const skillsRaw = storage.getItem(skillsKey), receiptsRaw = storage.getItem(receiptsKey), disabledRaw = storage.getItem(disabledKey);
  const current = readArray(storage, skillsKey), receipts = readArray(storage, receiptsKey), disabled = readArray(storage, disabledKey);
  const write = (key, value) => { checkAbort(signal); storage.setItem(key, value); };
  const restore = (key, value) => { checkAbort(signal); if (value === null) storage.removeItem(key); else storage.setItem(key, value); };
  const synchronizeDisabled = result => {
    const next = disabled.filter(name => name !== result.oldName);
    if (result.newName && result.disabled && !next.includes(result.newName)) next.push(result.newName);
    if (JSON.stringify(next) !== JSON.stringify(disabled)) write(disabledKey, JSON.stringify(next));
  };
  const prior = receipts.find(receipt => receipt.operationId === input.operation_id);
  const signature = await digest({action, input});
  checkAbort(signal);
  if (prior && (prior.signature !== signature || prior.action !== action))
    throw fail('operation_conflict', '同一 operation_id 不能用于不同的技能操作');
  const assertSnapshot = () => {
    checkAbort(signal);
    if (storage.getItem(skillsKey) !== skillsRaw || storage.getItem(receiptsKey) !== receiptsRaw || storage.getItem(disabledKey) !== disabledRaw)
      throw fail('version_conflict', '技能库已变化，请重试同一 operation_id');
  };
  if (prior) {
    const result = await currentResult(prior, current, true);
    assertSnapshot();
    if (prior.status === 'committed') return {...result, currentDisabled: result.newName ? disabled.includes(result.newName) : disabled.includes(result.oldName)};
    if (!result.currentMatches) throw fail('commit_conflict', '上一操作的保存结果不确定；请读取当前技能后重新确认');
    try {
      synchronizeDisabled(prior.result);
      write(receiptsKey, JSON.stringify(receipts.map(receipt => receipt === prior ? {...receipt, status: 'committed'} : receipt)));
    } catch (error) { appliedFailure(error, result); }
    return {...result, currentDisabled: prior.result.disabled};
  }
  if (builtinNames.includes(input.name) || action === 'rename' && builtinNames.includes(input.new_name))
    throw fail('builtin_skill', '不能修改或卸载官方内置技能');
  const previous = current.find(skill => skill.name === input.name);
  if (!previous || previous.custom !== true) throw fail('skill_not_found', '个人技能不存在：' + input.name);
  if (await skillVersion(previous) !== input.base_version)
    throw fail('version_conflict', '技能版本已变化；请读取当前技能后使用新的 operation_id');
  checkAbort(signal);
  let next, version = null;
  if (action === 'rename') {
    if (current.some(skill => skill.name === input.new_name)) throw fail('name_conflict', '已存在同名技能：' + input.new_name);
    const renamed = {...previous, name: input.new_name};
    if (previous.files) renamed.files = previous.files.map(file => file.path === (previous.entryPath || 'SKILL.md')
      ? {...file, content: renameEntry(file.content, renamed.name, previous.description)} : {...file});
    version = await skillVersion(renamed);
    next = current.map(skill => skill === previous ? renamed : skill);
  } else next = current.filter(skill => skill !== previous);
  const result = {name: input.new_name || input.name, oldName: input.name, newName: input.new_name || null,
    version, previousVersion: input.base_version, saved: true, renamed: action === 'rename', uninstalled: action === 'uninstall',
    disabled: action === 'rename' && (disabled.includes(input.name) || disabled.includes(input.new_name))};
  const receipt = {operationId: input.operation_id, signature, action, status: 'prepared', result};
  assertSnapshot();
  write(receiptsKey, JSON.stringify([...receipts, receipt]));
  let protectedDisabled = false;
  try {
    // Protect both identifiers before the rename. Storage exhaustion or a
    // cancellation after applying the skill must never enable a disabled skill.
    if (action === 'rename' && disabled.includes(input.name) && !disabled.includes(input.new_name)) {
      write(disabledKey, JSON.stringify([...disabled, input.new_name]));
      protectedDisabled = true;
    }
    write(skillsKey, JSON.stringify(next));
  }
  catch (error) {
    try { if (protectedDisabled) restore(disabledKey, disabledRaw); restore(receiptsKey, receiptsRaw); } catch {}
    throw error;
  }
  // A failed final receipt write leaves a prepared record. Retry only confirms
  // its observed result; it never renames/deletes a newly edited replacement.
  try {
    synchronizeDisabled(result);
    write(receiptsKey, JSON.stringify([...receipts, {...receipt, status: 'committed'}]));
  } catch (error) { appliedFailure(error, result); }
  return {...result, replayed: false, currentVersion: version, currentMatches: true, currentDisabled: result.disabled};
}

export function renamePersonalSkill(input, {storage = globalThis.localStorage, builtinNames = [], signal} = {}) {
  const args = argumentsFor('rename', input);
  return withLock(() => manage('rename', args, {storage, builtinNames, signal}));
}

export function uninstallPersonalSkill(input, {storage = globalThis.localStorage, builtinNames = [], signal} = {}) {
  const args = argumentsFor('uninstall', input);
  return withLock(() => manage('uninstall', args, {storage, builtinNames, signal}));
}
