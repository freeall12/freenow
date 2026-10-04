const cleanRows = rows => Array.isArray(rows) ? rows.filter(row => typeof row?.id === 'string' && row.id.length > 0 && row.id.length < 256 && ['public', 'personal'].includes(row.kind) && Number.isFinite(row.usedAt)).slice(0, 30) : [];

// A tiny dedicated IndexedDB reuses TemplateAPI's database namespace without
// changing personal template records, their migration baseline or DB version.
export function createRecentTemplateStore({indexedDB, databaseName, onChanged = () => {}, now = Date.now}) {
  let rows = [];
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('recent', {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('最近使用存储不可用'));
    request.onblocked = () => reject(Error('另一窗口阻止最近使用存储打开'));
  });
  const ready = database.then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction('recent', 'readonly'), request = transaction.objectStore('recent').get('history');
    transaction.oncomplete = () => { rows = cleanRows(request.result?.items); resolve(); };
    transaction.onerror = transaction.onabort = () => reject(transaction.error || Error('最近使用读取失败'));
  }));
  async function record(id, kind) {
    if (typeof id !== 'string' || !id || id.length >= 256 || !['public', 'personal'].includes(kind)) throw Error('最近使用模板标识无效');
    await ready;
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('recent', 'readwrite'), store = transaction.objectStore('recent'), request = store.get('history');
      let next;
      // Read and replace inside one transaction so other tabs cannot erase a
      // successful application; only committed writes update the visible list.
      request.onsuccess = () => {
        next = [{id, kind, usedAt: now()}, ...cleanRows(request.result?.items).filter(row => row.id !== id || row.kind !== kind)].slice(0, 30);
        store.put({id: 'history', items: next});
      };
      transaction.oncomplete = () => { rows = next; onChanged(structuredClone(rows)); resolve(); };
      transaction.onerror = transaction.onabort = () => reject(transaction.error || Error('最近使用保存失败'));
    });
  }
  return {ready, record, list: () => structuredClone(rows)};
}
