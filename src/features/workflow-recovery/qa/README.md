# 分组持久恢复：生产主壳 Computer Use QA

入口：`/src/features/workflow-recovery/qa/main.html?session=oct03-recovery-01`。

使用正在运行的本地静态服务器。此页面加载现有生产画布脚本、`WorkflowAPI`、恢复对话框、`GenerationAPI.runInPlace/recoverInPlace`、`GenerationCore.httpProvider`、`CanvasStore` 和 Web Locks。QA 不改变生产服务器配置、不新增服务器路由、不调用真实供应商。

**传输边界：HTTP 请求由页面内 `fetchImpl` 合同夹具模拟，未到达真实服务器 GET。**任务记录和传输日志持久保存于隔离 IndexedDB；输出来自实际本机 `contract-output.txt`，每条均明确标识合成合同文本。`actualProviderCalls=0` 是此夹具设计事实，不能作为真实 provider 或网络请求成功证据。

每个 session 对应独立画布、资源和传输数据库；缺省 project 参数会在启动前生成稳定的 QA project ID，保证不同 session 的 Web Lock 隔离。相同 URL 的第二页复用同一 QA project。刷新保留记录；“新隔离 session”创建新数据库，不删除历史记录。不要用生产项目 ID。

非默认项目首次打开时，夹具在隔离数据库事务内仅为不存在的项目键预置完整初始图；`store-bootstrap.js` 使生产 `CanvasStore.load` 等待该事务，然后真实读取并更新其 revision 基线。现有项目永不覆盖，生产加载失败保护仍有效。

## 最小验收步骤

1. 新 session 打开入口，诊断显示“生产恢复入口已就绪”。点“正式整组运行 / 恢复对话框”，在生产对话框点“确认”。等待 `POST=2`：首层 A/B 均 running，C pending，日志内两个不同原 job ID。
2. 点“刷新当前页”。应仍 `POST=2`，不得自动 POST C。点正式整组按钮，生产恢复对话框应显示原执行记录。点“查询原任务（生产恢复入口）”后，`byKeyGet` 增加，读取相同原 job ID。
3. 点“释放所有已派发合同结果”，等待首层应用。必要时再次点原任务查询。实际回读诊断应有 A/B applied，图及保存节点均具原 run/task 的 `workflowRecoveryResult`。此时 C 仍 pending，`POST=2`。
4. 点“明确继续未派发后层”。`POST=3`，新增任务仅 C。释放合同结果；完成后回读 A/B/C 持久 applied，不新增结果节点或重复历史。

## 停止、故障与竞争

- **停止不取消已派发：**新 session 运行到 `POST=2` 后点“停止整组”。应 `stopping=true`，`DELETE=0`，C 无 POST。释放首层后允许查回与应用首层；继续后层应拒绝。刷新查询仍不重发。
- **登记 / POST 前保存失败：**新 session，选择“计划保存”“原任务登记保存”或“最终请求签名保存（POST前）”，点“阻断所选阶段下一次保存”，再正式运行。选计划/登记阶段应 POST=0；最终签名阶段单个故障不保证同层兄弟尚未发出，但受阻节点必须无 POST，后层必须无 POST。旧持久快照仍可读，原 ID 不可换 ID重发。
- **画布 / 完成收据失败：**首层 POST 完后，选“画布保存”或“完成收据保存”并阻断，再释放结果。生产应用不能以 provider succeeded 推进 C；记录保留 applying/未确认状态。刷新查询应凭原任务、结果标记及完整持久版本恢复，无法证明则保持阻断。故障是当前页单次显式注入，页面诊断列出阶段与时间。
- **unknown/404：**首层 POST 完刷新后，点“将原任务 GET 设为 404”，再查询原任务；应 unknown/错误并阻断继续，POST不增加。点“恢复原任务 GET”后可继续查询原 ID，不生成新 ID。
- **多 tab：**第一页就绪后点“打开相同 session 的第二页”。第二页正式生产整组/恢复对话框应只读并显示锁原因；运行/继续不得增加 POST。关闭持锁第一页后，刷新第二页，再明确查询/接管；不得自动新生成。

所有操作按钮及 JSON 诊断都可见，不需要 page evaluate。诊断包含持久传输计数、逐次 POST 原 ID、GET、DELETE、journal storageRevision、任务状态、live/saved 图结果标记及故障信息。自动每 1.2 秒只读回读；读记录不会派发任务。

## 验证边界

这是可复现浏览器验收入口，提供生产 host/UI 与持久模拟传输的组合。仅静态语法检查不能证明浏览器验收通过；主任务须实际打开、点击、刷新和观察可见诊断后记录结果。真实服务器 GET、真实模型生成、媒体下载及供应商取消不在此夹具证明范围内。
