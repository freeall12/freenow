const test = require('node:test');
const assert = require('node:assert/strict');
const modules = Promise.all([
  import('../src/features/agent-skills/management.mjs'),
  import('../src/features/agent-manager/skill-commit.mjs'),
]);
const skillsKey = 'tapnow-custom-skills', receiptsKey = 'tapnow-skill-commits-v1';
const skill = (name = 'personal-plan') => ({name, description: '计划描述', text: '制定计划', custom: true,
  entryPath: 'entry.md', sourceName: 'uploaded-package', files: [
    {path: 'entry.md', content: '\uFEFF---\r\nname: personal-plan\r\ndescription: original metadata\r\nlicense: MIT\r\n---\r\n制定计划\r\n'},
    {path: 'references/steps.md', content: '# 检查\n保留原文件'},
  ]});
function store(items = []) {
  const values = new Map([[skillsKey, JSON.stringify(items)]]);
  const writes = [];
  return {values, writes, getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push({key, value}); values.set(key, value); }, removeItem: key => values.delete(key),
    read: () => JSON.parse(values.get(skillsKey)), receipts: () => JSON.parse(values.get(receiptsKey) || '[]')};
}
const conflict = code => error => error.code === code;
const argsFor = async (item, operation_id, extra = {}) => {
  const [, {skillVersion}] = await modules;
  return {name: item.name, base_version: await skillVersion(item), operation_id, ...extra};
};

test('rename persists package metadata and entry name, preserves files/order, and retries without writes', async () => {
  const [{renamePersonalSkill}, {skillVersion}] = await modules;
  const original = skill(), other = skill('other-plan'), storage = store([original, other]);
  const args = await argsFor(original, 'rename-one', {new_name: 'new-plan'});
  const result = await renamePersonalSkill(args, {storage});
  const renamed = storage.read()[0];
  assert.equal(result.saved, true);assert.equal(result.oldName, original.name);assert.equal(result.newName, 'new-plan');
  assert.equal(result.currentMatches, true);assert.equal(result.version, await skillVersion(renamed));
  assert.notEqual(result.version, args.base_version);assert.deepEqual(storage.read()[1], other);
  assert.equal(renamed.text, original.text);assert.equal(renamed.sourceName, original.sourceName);
  assert.equal(renamed.entryPath, original.entryPath);assert.deepEqual(renamed.files[1], original.files[1]);
  assert.equal(renamed.files[0].content, original.files[0].content.replace('name: personal-plan', 'name: new-plan'));
  const writes = storage.writes.length;
  assert.equal((await renamePersonalSkill(args, {storage})).replayed, true);
  assert.equal(storage.writes.length, writes);
});

test('rename handles legacy text records and entry files without frontmatter', async () => {
  const [{renamePersonalSkill}] = await modules;
  const original = {...skill(), files: [{path: 'entry.md', content: '# Original\nInstruction'}]}, storage = store([original]);
  await renamePersonalSkill(await argsFor(original, 'plain-entry', {new_name: 'plain-plan'}), {storage});
  assert.match(storage.read()[0].files[0].content, /^---\nname: plain-plan\ndescription: "计划描述"\n---\n# Original\nInstruction$/);
  const legacy = {name: 'legacy-plan', description: '旧技能', text: 'legacy text', custom: true}, second = store([legacy]);
  await renamePersonalSkill(await argsFor(legacy, 'legacy-rename', {new_name: 'legacy-new'}), {storage: second});
  assert.deepEqual(second.read()[0], {...legacy, name: 'legacy-new'});
});

test('builtins, duplicate destinations and stale versions never mutate storage', async () => {
  const [{renamePersonalSkill, uninstallPersonalSkill}] = await modules;
  const original = skill(), storage = store([original, skill('occupied')]);
  const args = await argsFor(original, 'guard-rename', {new_name: 'new-plan'});
  await assert.rejects(renamePersonalSkill(args, {storage, builtinNames: [original.name]}), conflict('builtin_skill'));
  await assert.rejects(renamePersonalSkill({...args, new_name: 'builtin'}, {storage, builtinNames: ['builtin']}), conflict('builtin_skill'));
  await assert.rejects(renamePersonalSkill({...args, new_name: 'occupied'}, {storage}), conflict('name_conflict'));
  await assert.rejects(renamePersonalSkill({...args, base_version: 'f'.repeat(64)}, {storage}), conflict('version_conflict'));
  const uninstall = await argsFor(original, 'guard-remove');
  await assert.rejects(uninstallPersonalSkill(uninstall, {storage, builtinNames: [original.name]}), conflict('builtin_skill'));
  await assert.rejects(uninstallPersonalSkill({...uninstall, name: 'missing'}, {storage}), conflict('skill_not_found'));
  assert.equal(storage.writes.length, 0);
  assert.throws(() => renamePersonalSkill({...args, new_name: 'Bad Name'}, {storage}), conflict('invalid_name'));
  assert.throws(() => renamePersonalSkill({...args, new_name: original.name}, {storage}), conflict('invalid_name'));
  assert.throws(() => uninstallPersonalSkill({...uninstall, base_version: '0'}, {storage}), conflict('invalid_version'));
});

test('uninstall matches manager removal; replay never deletes a recreated record', async () => {
  const [{uninstallPersonalSkill}] = await modules;
  const original = skill(), storage = store([original, skill('other-plan')]);
  const args = await argsFor(original, 'remove-one');
  const result = await uninstallPersonalSkill(args, {storage});
  assert.equal(result.uninstalled, true);assert.equal(result.oldName, original.name);assert.equal(result.newName, null);
  assert.equal(result.currentVersion, null);assert.deepEqual(storage.read().map(item => item.name), ['other-plan']);
  assert.equal((await uninstallPersonalSkill(args, {storage})).currentMatches, true);
  storage.setItem(skillsKey, JSON.stringify([...storage.read(), original]));
  const replay = await uninstallPersonalSkill(args, {storage});
  assert.equal(replay.replayed, true);assert.equal(replay.currentMatches, false);
  assert.equal(storage.read().length, 2);
});

test('all skill operations share stable operation IDs and reject changed arguments', async () => {
  const [{renamePersonalSkill, uninstallPersonalSkill}, {commitSkill}] = await modules;
  const original = skill(), storage = store([original]);
  const args = await argsFor(original, 'shared-op-id', {new_name: 'new-plan'});
  await renamePersonalSkill(args, {storage});
  await assert.rejects(renamePersonalSkill({...args, new_name: 'other-plan'}, {storage}), conflict('operation_conflict'));
  await assert.rejects(uninstallPersonalSkill(await argsFor(storage.read()[0], args.operation_id), {storage}), conflict('operation_conflict'));
  await assert.rejects(commitSkill({name: 'another', description: 'd', instructions: 'i', base_version: '0', operation_id: args.operation_id}, {storage}), conflict('operation_conflict'));
  const second = store();
  await commitSkill({name: 'created', description: 'd', instructions: 'i', base_version: '0', operation_id: 'save-first'}, {storage: second});
  await assert.rejects(renamePersonalSkill(await argsFor(second.read()[0], 'save-first', {new_name: 'new-plan'}), {storage: second}), conflict('operation_conflict'));
});

test('write-ahead recovery confirms applied rename/uninstall and refuses uncertain changed content', async () => {
  const [{renamePersonalSkill, uninstallPersonalSkill}] = await modules;
  for (const action of ['rename', 'uninstall']) {
    const original = skill(), storage = store([original]);
    const args = await argsFor(original, 'recover-' + action, action === 'rename' ? {new_name: 'new-plan'} : {});
    const invoke = action === 'rename' ? renamePersonalSkill : uninstallPersonalSkill;
    const write = storage.setItem.bind(storage);let receiptWrites = 0;
    storage.setItem = (key, value) => { if (key === receiptsKey && ++receiptWrites === 2) throw Error('receipt quota');write(key, value); };
    await assert.rejects(invoke(args, {storage}), error => {
      assert.match(error.message, /receipt quota/);assert.equal(error.applied, true);
      assert.equal(error.receipt.applied, true);assert.equal(error.receipt.receiptConfirmed, false);
      assert.equal(error.receipt.currentMatches, true);assert.equal(error.receipt.oldName, original.name);
      return true;
    });
    assert.equal(storage.receipts()[0].status, 'prepared');
    storage.setItem = write;
    const recovered = await invoke(args, {storage});
    assert.equal(recovered.replayed, true);assert.equal(recovered.currentMatches, true);
    assert.equal(storage.receipts()[0].status, 'committed');
  }
  const original = skill(), storage = store([original]), args = await argsFor(original, 'uncertain-rename', {new_name: 'new-plan'});
  const write = storage.setItem.bind(storage);let receiptWrites = 0;
  storage.setItem = (key, value) => { if (key === receiptsKey && ++receiptWrites === 2) throw Error('receipt quota');write(key, value); };
  await assert.rejects(renamePersonalSkill(args, {storage}), /receipt quota/);
  storage.setItem = write;
  storage.setItem(skillsKey, JSON.stringify([{...storage.read()[0], text: 'manual edit'}]));
  await assert.rejects(renamePersonalSkill(args, {storage}), conflict('commit_conflict'));
  assert.equal(storage.read()[0].text, 'manual edit');
});

test('failed collection write rolls back receipt; later replay reports intervening rename edits', async () => {
  const [{renamePersonalSkill}] = await modules;
  const original = skill(), storage = store([original]), args = await argsFor(original, 'write-failure', {new_name: 'new-plan'});
  const write = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === skillsKey) throw Error('skill quota');write(key, value); };
  await assert.rejects(renamePersonalSkill(args, {storage}), /skill quota/);
  assert.equal(storage.getItem(receiptsKey), null);assert.deepEqual(storage.read(), [original]);
  storage.setItem = write;
  await renamePersonalSkill(args, {storage});
  storage.setItem(skillsKey, JSON.stringify([{...storage.read()[0], text: 'manual edit'}]));
  const replay = await renamePersonalSkill(args, {storage});
  assert.equal(replay.currentMatches, false);assert.equal(replay.saved, true);
  assert.equal(storage.read()[0].text, 'manual edit');
});

test('concurrent save/rename keeps successful updates or returns version conflict without losing records', async () => {
  const [{renamePersonalSkill}, {commitSkill}] = await modules;
  const original = skill(), storage = store([original]);
  const args = await argsFor(original, 'race-rename', {new_name: 'new-plan'});
  const results = await Promise.allSettled([
    renamePersonalSkill(args, {storage}),
    commitSkill({name: 'separate-plan', description: 'd', instructions: 'i', base_version: '0', operation_id: 'race-save'}, {storage}),
  ]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') assert.equal(results[i].reason.code, 'version_conflict');
    else assert.ok(storage.read().some(item => item.name === (i === 0 ? 'new-plan' : 'separate-plan')));
  }
  assert.ok(storage.read().some(item => ['personal-plan', 'new-plan'].includes(item.name)));
});

test('disabled rename protects both names before writing skill and safely retries failed cleanup', async () => {
  const [{renamePersonalSkill}] = await modules;
  const original = skill(), storage = store([original]), disabledKey = 'tapnow-disabled-skills';
  storage.setItem(disabledKey, JSON.stringify([original.name, 'unrelated']));
  const args = await argsFor(original, 'disabled-rename', {new_name: 'new-plan'});
  const write = storage.setItem.bind(storage);let disabledWrites = 0;
  storage.setItem = (key, value) => {
    if (key === disabledKey && ++disabledWrites === 2) throw Error('cleanup quota');
    if (key === skillsKey) assert.ok(JSON.parse(storage.getItem(disabledKey)).includes('new-plan'));
    write(key, value);
  };
  await assert.rejects(renamePersonalSkill(args, {storage}), error => {
    assert.match(error.message, /cleanup quota/);assert.equal(error.applied, true);
    assert.equal(error.receipt.applied, true);assert.equal(error.receipt.receiptConfirmed, false);
    assert.equal(error.receipt.currentMatches, true);assert.equal(error.receipt.newName, 'new-plan');
    return true;
  });
  assert.equal(storage.read()[0].name, 'new-plan');
  assert.deepEqual(JSON.parse(storage.getItem(disabledKey)), [original.name, 'unrelated', 'new-plan']);
  assert.equal(storage.receipts()[0].status, 'prepared');
  storage.setItem = (key, value) => { if (key === disabledKey) throw Error('retry cleanup quota');write(key, value); };
  await assert.rejects(renamePersonalSkill(args, {storage}), error => {
    assert.equal(error.applied, true);assert.equal(error.receipt.replayed, true);
    assert.equal(error.receipt.receiptConfirmed, false);assert.equal(error.receipt.currentMatches, true);return true;
  });
  assert.equal(storage.receipts()[0].status, 'prepared');
  storage.setItem = write;
  const replay = await renamePersonalSkill(args, {storage});
  assert.equal(replay.replayed, true);assert.equal(replay.disabled, true);assert.equal(replay.currentDisabled, true);
  assert.deepEqual(JSON.parse(storage.getItem(disabledKey)), ['unrelated', 'new-plan']);
  assert.equal(storage.receipts()[0].status, 'committed');
  // A completed receipt must not undo a later explicit enable action.
  storage.setItem(disabledKey, JSON.stringify(['unrelated']));
  const writes = storage.writes.length;
  assert.equal((await renamePersonalSkill(args, {storage})).currentDisabled, false);
  assert.equal(storage.writes.length, writes);
});

test('protection quota failure leaves disabled original intact; failed skill write restores protection', async () => {
  const [{renamePersonalSkill}] = await modules;
  const original = skill(), disabledKey = 'tapnow-disabled-skills';
  for (const failedKey of [disabledKey, skillsKey]) {
    const storage = store([original]);storage.setItem(disabledKey, JSON.stringify([original.name]));
    const write = storage.setItem.bind(storage);
    storage.setItem = (key, value) => { if (key === failedKey) throw Error('quota');write(key, value); };
    await assert.rejects(renamePersonalSkill(await argsFor(original, 'quota-' + failedKey, {new_name: 'new-plan'}), {storage}), /quota/);
    assert.deepEqual(storage.read(), [original]);
    assert.deepEqual(JSON.parse(storage.getItem(disabledKey)), [original.name]);
    assert.equal(storage.getItem(receiptsKey), null);
  }
});

test('abort while waiting or hashing performs no storage writes', async () => {
  const [{renamePersonalSkill}] = await modules;
  for (const duringHash of [false, true]) {
    const original = skill(), storage = store([original]), controller = new AbortController();
    const args = await argsFor(original, 'abort-' + duringHash, {new_name: 'new-plan'});
    if (!duringHash) controller.abort();
    const pending = renamePersonalSkill(args, {storage, signal: controller.signal});
    if (duringHash) { await Promise.resolve();controller.abort(); }
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.equal(storage.writes.length, 0);assert.deepEqual(storage.read(), [original]);
  }
});

test('abort after applying rename or uninstall preserves result and retries only receipt/disabled cleanup', async () => {
  const [{renamePersonalSkill, uninstallPersonalSkill}] = await modules;
  const disabledKey = 'tapnow-disabled-skills';
  for (const action of ['rename', 'uninstall']) {
    const original = skill(), storage = store([original]), controller = new AbortController();
    storage.setItem(disabledKey, JSON.stringify([original.name]));
    const write = storage.setItem.bind(storage), args = await argsFor(original, 'abort-after-' + action, action === 'rename' ? {new_name: 'new-plan'} : {});
    storage.setItem = (key, value) => { write(key, value);if (key === skillsKey) controller.abort(); };
    const invoke = action === 'rename' ? renamePersonalSkill : uninstallPersonalSkill;
    await assert.rejects(invoke(args, {storage, signal: controller.signal}), error => {
      assert.equal(error.name, 'AbortError');assert.equal(error.receipt, undefined);return true;
    });
    assert.equal(storage.receipts()[0].status, 'prepared');
    assert.deepEqual(storage.read().map(item => item.name), action === 'rename' ? ['new-plan'] : []);
    if (action === 'rename') assert.ok(JSON.parse(storage.getItem(disabledKey)).includes('new-plan'));
    const count = storage.writes.filter(item => item.key === skillsKey).length;
    storage.setItem = write;
    const replay = await invoke(args, {storage});
    assert.equal(replay.replayed, true);assert.equal(replay.currentMatches, true);
    assert.equal(storage.writes.filter(item => item.key === skillsKey).length, count);
    assert.deepEqual(JSON.parse(storage.getItem(disabledKey)), action === 'rename' ? ['new-plan'] : []);
  }
});
