import {createAppController, prepareApp} from '../integration.mjs';
const status = document.querySelector('#status'), cards = document.querySelector('#cards'), reply = document.querySelector('#reply');
let chat = {messages: [], replies: []};
let database;
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tapnow-qa-director-markup-v1', 1);
    request.onupgradeneeded = () => {request.result.createObjectStore('sessions');};
    request.onsuccess = () => {const db = request.result;db.onversionchange = () => db.close();resolve(db);};
    request.onerror = () => reject(request.error || Error('本页存储未能打开'));
    request.onblocked = () => reject(Error('本页存储被其他页面阻塞，请关闭旧验收页后重试'));
  });
}
function load() {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('sessions', 'readonly'), request = transaction.objectStore('sessions').get('current');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || Error('本页存储读取失败'));
  });
}
function save() {
  // Success is the committed transaction, not an accepted put request.
  const snapshot = structuredClone(chat);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('sessions', 'readwrite');
    transaction.objectStore('sessions').put(snapshot, 'current');
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error || Error('本页存储保存失败'));
  });
}
function showReplies() {reply.value = chat.replies.map(item => item.text).join('\n\n');status.textContent = `已保存 ${chat.messages.length} 个批注页；实际排队 ${chat.replies.length} 次。未调用模型。`;}
const controller = createAppController({
  getContext: () => ({chat, panelActive: true, pageLeaving: false, streaming: document.querySelector('#busy').checked}),
  onSaveState: async (current, trace, state) => {const previous = trace.appState;trace.appState = state;try {await save();} catch (error) {trace.appState = previous;throw error;}},
  onQueuePrompt: async (text, trace, current, metadata, isSourceCurrent = () => true) => {
    if (document.querySelector('#busy').checked || !isSourceCurrent()) return false;
    if (chat.replies.some(item => item.handoffId === metadata?.handoffId && item.traceId === trace.id)) return true;
    const previous = chat.replies, entry = {traceId: trace.id, handoffId: metadata?.handoffId, text}, next = [...previous, entry];chat.replies = next;
    let committed = false;
    try {await save();committed = true;if (!isSourceCurrent()) throw Error('保存期间批注页来源已切换或重载');}
    catch (error) {
      chat.replies = chat.replies === next ? previous : chat.replies.filter(item => item !== entry);
      if (committed) {try {await save();} catch (failure) {throw Error('验收交接撤销未能保存：' + failure.message);}}
      throw error;
    }
    showReplies();return true;
  },
  onError: message => {status.textContent = message;},
});
function render() {controller.prune(chat.messages);for (const trace of chat.messages) {const element = controller.render(trace);if (element && element.parentElement !== cards) cards.append(element);}showReplies();}
document.querySelector('#open').onclick = async () => {
  document.querySelector('#open').disabled = true;
  try {
    const args = {resource_uri: 'ui://tapnow/director-markup@v1', data: {draft: document.querySelector('#draft').value}};
    const trace = {id: crypto.randomUUID(), name: 'show_app', args, status: 'done', result: prepareApp(args)}, previous = chat.messages;
    chat.messages = [...previous, trace];try {await save();} catch (error) {chat.messages = previous;throw error;}render();
  } catch (error) {status.textContent = error.message;} finally {document.querySelector('#open').disabled = false;}
};
document.querySelector('#rerender').onclick = render;document.querySelector('#busy').onchange = render;
try {
  database = await openDatabase();const saved = await load();
  if (saved !== undefined) {
    if (!saved || !Array.isArray(saved.messages) || !Array.isArray(saved.replies)) throw Error('本页已保存验收数据无效');
    chat = saved;
  }
  render();for (const id of ['open', 'rerender', 'busy']) document.getElementById(id).disabled = false;
} catch (error) {status.textContent = `验收页未就绪：${error.message}`;}
