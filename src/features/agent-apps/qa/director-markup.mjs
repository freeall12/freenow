import {createAppController, prepareApp} from '../integration.mjs';
const status = document.querySelector('#status'), cards = document.querySelector('#cards'), reply = document.querySelector('#reply');
let chat = {messages: [], replies: []};
let database, panelOpen = true, pendingSaves = 0, committedSaves = 0;
const committedStates = new Map(), persistence = document.querySelector('#persistence'), stateOutput = document.querySelector('#state');
const locale = document.querySelector('#locale'), saveDelay = document.querySelector('#save-delay'), failSave = document.querySelector('#fail-save');
const titles = {'zh-CN':'导演画线批注','en-US':'Director Markup','ja-JP':'監督マークアップ','ko-KR':'감독 마크업','fr-FR':'Annotations de réalisation'};
function openDatabase() {
  return new Promise((resolve, reject) => {
    const session = new URL(location.href).searchParams.get('session') ?? 'default';
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(session)) return reject(Error('验收session须为1–48个字母、数字、下划线或短横线'));
    const request = indexedDB.open('tapnow-qa-director-markup-v1' + (session === 'default' ? '' : '-' + session), 1);
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
function showReplies() {reply.value = chat.replies.map(item => item.text).join('\n\n');status.textContent = `已保存 ${chat.messages.length} 个批注页；实际排队 ${chat.replies.length} 次。${panelOpen?'面板已打开':'面板已关闭'}。未调用模型。`;stateOutput.value = JSON.stringify(chat.messages.map(trace => ({id:trace.id, state:committedStates.get(trace.id)??null})),null,2);}
const controller = createAppController({
  getContext: () => ({chat, panelActive: panelOpen, pageLeaving: false, streaming: document.querySelector('#busy').checked}),
  onSaveState: async (current, trace, state) => {
    const previous = trace.appState, shouldFail = failSave.checked, delay = Math.max(0,Math.min(5000,Number(saveDelay.value)||0));failSave.checked = false;
    pendingSaves++;persistence.textContent = `状态保存中；待完成 ${pendingSaves} 次，已提交 ${committedSaves} 次。`;
    try {if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(shouldFail)throw Error('验收注入：状态保存失败，尚未提交');trace.appState = state;await save();committedStates.set(trace.id,structuredClone(state));committedSaves++;showReplies();}
    catch(error) {trace.appState = previous;status.textContent = error.message;throw error;}
    finally {pendingSaves--;persistence.textContent = `状态保存结束；待完成 ${pendingSaves} 次，已提交 ${committedSaves} 次。${shouldFail?'上次保存失败；可重试。':''}`;}
  },
  onQueuePrompt: async (text, trace, current, metadata, isSourceCurrent = () => true) => {
    if (document.querySelector('#busy').checked || !isSourceCurrent()) return false;
    if (chat.replies.some(item => item.handoffId === metadata?.handoffId && item.traceId === trace.id)) return true;
    const previous = chat.replies, entry = {traceId: trace.id, handoffId: metadata?.handoffId, text}, next = [...previous, entry];chat.replies = next;
    let committed = false;
    try {await save();committed = true;if (document.querySelector('#busy').checked || !isSourceCurrent()) throw Error('保存期间批注页来源已切换或重载');}
    catch (error) {
      chat.replies = chat.replies === next ? previous : chat.replies.filter(item => item !== entry);
      if (committed) {try {await save();} catch (failure) {throw Error('验收交接撤销未能保存：' + failure.message);}}
      throw error;
    }
    showReplies();return true;
  },
  onError: message => {status.textContent = message;},
});
function render() {controller.prune(chat.messages);if(!panelOpen){cards.replaceChildren();showReplies();return;}for (const trace of chat.messages) {const element = controller.render(trace);if (element && element.parentElement !== cards) cards.append(element);}showReplies();}
document.querySelector('#open').onclick = async () => {
  document.querySelector('#open').disabled = true;
  try {
    const args = {resource_uri: 'ui://tapnow/director-markup@v1', title:titles[locale.value], data: {draft: document.querySelector('#draft').value, locale:locale.value}};
    const trace = {id: crypto.randomUUID(), name: 'show_app', args, status: 'done', result: prepareApp(args)}, previous = chat.messages;
    chat.messages = [...previous, trace];try {await save();} catch (error) {chat.messages = previous;throw error;}panelOpen=true;render();
  } catch (error) {status.textContent = error.message;} finally {document.querySelector('#open').disabled = false;}
};
document.querySelector('#rerender').onclick = render;document.querySelector('#busy').onchange = render;
document.querySelector('#close').onclick = async () => {try {await controller.prepareToClose();panelOpen=false;render();} catch(error) {status.textContent=error.message+'；页面已保留，可再次关闭重试';} finally {controller.cancelClose();}};
document.querySelector('#reopen').onclick = () => {panelOpen=true;render();};
document.querySelector('#reload').onclick = async () => {try {await controller.prepareToClose();controller.reset();cards.replaceChildren();render();} catch(error) {status.textContent=error.message+'；页面已保留';} finally {controller.cancelClose();}};
try {
  database = await openDatabase();const saved = await load();
  if (saved !== undefined) {
    if (!saved || !Array.isArray(saved.messages) || !Array.isArray(saved.replies)) throw Error('本页已保存验收数据无效');
    chat = saved;
    for(const trace of chat.messages)if(trace.appState)committedStates.set(trace.id,structuredClone(trace.appState));
  }
  render();for (const id of ['open', 'rerender', 'busy', 'locale', 'close', 'reopen', 'reload', 'save-delay', 'fail-save']) document.getElementById(id).disabled = false;
} catch (error) {status.textContent = `验收页未就绪：${error.message}`;}
