# 本地画布项目

点击左上画布名称打开搜索列表，在底部选择「新建画布」。画布菜单另提供新建、切换、重命名、立即保存与原有视图操作。名称支持1–120字符；空白名称拒绝保存。同名项目允许创建，身份始终由ID决定。

新项目为空白画布，视口为 `{x:0,y:0,scale:1}`。节点、连线、名称、视口及最多60步撤销/重做历史独立保存到当前浏览器。个人素材和API配置的作用域仍由各自模块定义。

## URL 和存储

- 默认项目 ID 是 `canvas`，无 `project` 参数；保留原 `documents` 对象存储的 `canvas` key 及旧 localStorage 数据。
- 新项目 URL 是 `/?project=<UUID>`，保留已有其它查询参数；对应 key 为 `project:<UUID>`。
- 数据库名称及版本保持原值，不创建新的对象存储、不执行存储迁移、不删除已有记录。
- 整页启动时捕获项目身份。切换先验证目标、等待当前保存完成、重新检查任务状态，再完整导航，以隔离模块闭包与正在运行的状态。没有全局「当前项目」localStorage key。
- 视口旧项目保留 `tapnow-canvas-view-v1`；新项目用 `tapnow-canvas-view-v1:project:<UUID>`。文档快照也包含视口。
- 记录字段 `project` 包含 `id,title,createdAt,updatedAt`，`storageRevision` 是提交版本；旧记录首次读视为版本0。`view,history,future` 与图一起保存。

## 保存保护

项目读取完成前，图修改入口停止执行。读取失败或未知项目URL停止保存，避免用初始图覆盖已有记录。

所有保存同步捕获快照，等待真实 IndexedDB 事务提交。切换与新建必须等待本次保存的 Promise；快照/structuredClone 的同步异常不会被旧的成功 flush 掩盖。失败保留原页和未保存提示，可以继续保留并重试。

同项目多窗口采用事务内版本比较：读时记住本页版本，写时在同一 readwrite 事务里读取已有版本并比较。过期页面收到 `CanvasProjectConflictError`，不覆盖另一窗口的数据，也不能跳到新项目。当前没有自动合并和强制覆盖入口；版本冲突时需保留未保存页并人工处理。不同项目记录可以同时保存。

原有生成、图片编辑与Agent模块有仅保存 `{version,nodes,edges}` 的适配器。Store为当前项目同步补充 `CanvasApp.projectSnapshot()` 的真实名称、视口和当前撤销历史；不会用当前项目信息污染新建项目的显式快照。

图片编辑器、片场未关闭，以及生成任务处于 queued/running/unknown 或结果正在应用时阻挡项目导航。Agent额外注册其写入、上传、运行和草稿保存保护。不会自动放弃编辑或终止任务来切换。

## 集成 API

```js
CanvasProjects.id();                    // 本页固定 ID
CanvasProjects.current();               // 名称、ID和时间元数据副本
CanvasProjects.storageKey('some-key');  // 默认保留旧键，新项目后缀 :project:<ID>
CanvasProjects.namespace('some-db');    // 同上规则
CanvasProjects.url(id);                 // 目标项目URL，保留其他query
await CanvasProjects.create('名称');     // 完成当前保存后创建，返回元数据，不自动导航
await CanvasProjects.switchTo(id);     // 检查、保存、完整导航
await CanvasProjects.rename('名称');
const unregister = CanvasProjects.registerNavigationGuard(async () => {
  return running ? '任务尚未完成' : null;
});
await CanvasApp.saveProject();
CanvasApp.projectSnapshot();            // 当前完整项目快照
CanvasApp.projectIdentity();
```

Guard返回空值表示允许；非空字符串或抛出的异常阻挡导航。取消注册调用 `unregister()`。

`CanvasStore.load(id?) / save(state,id?) / listProjects() / flush()` 操作项目；`readRecord(key) / writeRecord(key,value)` 只允许 `agent-` / `comments-` 前缀，供Agent与评论在localStorage容量不足时使用同一 documents store。Agent与评论记录不出现在项目列表中。writeRecord同样等待事务提交并参与flush。

## 验证

```sh
node --test tests/canvas-projects.test.cjs tests/canvas-storage-reliability.test.cjs tests/canvas-app-persistence.test.cjs tests/canvas-navigation.test.cjs
```

61项通过，覆盖多项目/多标签页、同项目版本冲突、提交失败、同步克隆失败、读取前修改阻挡、旧适配器快照保留、标题和撤销历史、真实flush及既有回归。UI浏览器验收由主任务记录，单元回归不能替代视觉和真实浏览器证据。
