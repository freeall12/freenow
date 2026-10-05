# 皮肤编辑器前端生命周期（2026-10-05）

皮肤编辑器沿用原站增强节点：连接来源后选择细节增强、标准增强或重度增强，生成结果回填既有增强节点并记录版本。Topaz 与 Magnific 保留各自的参数和请求语义。

## 参考证据与范围

- 只读 `reference/image-enhance.md` 的原站 UI、参数、定位、原 SVG 采集记录。
- 本机官方安装包 `/Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js` 的 `uOl/cOl/dOl`：原服务为 Enhancor；细节模式与标准/重度模式对应不同固定操作。
- 前端只提交 `parameters:{mode}`，不增加猜测的 provider/model/自由 prompt 或通用强度参数。完整来源 input 声明 `role:'source_image'`。
- 原生 provider 的可用性、媒体转换与公开服务合同由独立 profile/media 和共享任务 pipeline 校验。配置是否就绪不能证明实际模型权限或结果质量。

## 实现

`image-enhance-ui.mjs` 使用 `src/features/image-skin/operation.mjs`：

1. 先等待 `GenerationAPI.availability({request,signal})` 和公开 `configuration()`，再允许进入 `runInPlace` 的媒体准备/任务提交。
2. 准备阶段关闭面板、切换节点或 Escape 会 abort；派发前再次核查配置快照和来源意图。
3. `source-guard.mjs` 绑定当前项目、原增强节点、原来源对象、真实入边对象及内容、完整图片字段、选区、metadata、完整参数和历史版本。相同 ID 的对象替换、换图、断边/重连或撤销对象替换均不能继承原授权。
4. 生成完成后使用 `result-application.mjs` 回填同一节点，新增一个生成版本并保留既有版本；等待 `CanvasApp.saveProject()` 完成后才报告已应用。
5. 保存失败显示“结果待保存”，调用原 job 的 `retryApplication` 保存相同结果，避免二次生成、重复 update 或重复版本。
6. `unknown` 显示“状态待确认”，生成按钮改为查询原增强任务，只调用 `recover(originalJobId)`；恢复成 running 后继续原任务。没有 unknown→submit 的分支。
7. `onPrepared(job)` 保存完成原尺寸 PNG 准备后的最终请求。结果应用及查询恢复均用同一个 `verifyRequest` 比较原任务 ID 和最终请求，并在 emit/application 之前核查来源守卫，防止普通任务托盘恢复跳过校验。

三种增强面板的 footer 已移除参考点数和固定分钟数，展示真实配置/准备/保存/恢复状态。保留原生成 SVG、36px footer、400px 面板定位和选项/滑杆布局。

## 接口

```js
createEnhanceSourceGuard(app, target, source, {
  signal, isAlive, requireSelection
}) // guard({targetSnapshot?})

createEnhanceResultApplication({
  app, node:target, parent:source, label, parameters, legacyVersions
}) // {guard, applied, async apply(output)}; apply 返回原 target 对象
```

`apply` 的持久化重试必须使用同一个 application 实例。结果应用后若项目、原对象、源图、边、参数、媒体或版本被改动，重试会拒绝覆盖。

皮肤完整图片限制在 `image.skin` 路径执行，未添加到 Topaz/Magnific 的请求上。

## 已验证

```bash
node --test tests/image-enhance.test.cjs tests/image-skin-frontend.test.cjs
node --check image-enhance-ui.mjs
node --check src/features/image-skin/operation.mjs
node --check src/features/image-skin/result-application.mjs
env -i PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node --test src/features/image-skin/qa/server.test.cjs
```

本轮 12/12 定向测试通过，其中新增 6 项覆盖原对象/来源/边/完整参数/项目迟到保护、取消、完整图片范围、保存失败重试和原 job 的未知状态恢复，以及最终 PNG 请求和查询期间来源变化拒绝。另有 2/2 隔离 HTTP 集成测试，走正式 dedicated `skin-tasks-v1`、routed 网关、三档原 PNG 来源、实际结果完整解码/归档及未知任务原 GET 查询；三档共 3 次 supplier POST，没有因 unknown 重复 POST。使用合成服务和来源，不读取真实 Key，不调用付费模型。

正式入口隔离宿主和操作说明见 `src/features/image-skin/qa/README.md`。该宿主加载正式主入口、正式增强面板和 TaskService；仅外部专用网关 HTTP 及可选 Agent 模型回复为合成边界。

## 浏览器验收边界

本文件初版仅记录代码和定向测试验证；浏览器由主代理独占操作。以下项需要主代理实测记录，不能由旧参考里的 35/35 或旧截图替代本轮证据：

- Topaz/Magnific/皮肤切换后的配置反馈和 400×280 / 400×392 / 400×176 正常面板几何。
- 下拉菜单重开、当前值/勾选、方向键/Home/End/Enter、Escape 触发器焦点、外点关闭。
- tab 左右键/Home/End，切换后焦点落在被选 tab。
- 指南 tooltip、重度模式警告、滑杆数值与真实参数保存、刷新重开。
- 未配置不创建任务；准备期间关闭阻止媒体/派发；运行后关闭仍按原节点守卫保存。
- unknown 查询原 job；保存失败重试无新增 version/节点/任务；刷新从持久化读取实际结果。

旧 `qa/image-enhance-check.js` 的“缺配置仍创建 configuration_required job”断言已不符合本轮前置配置检查，需要使用本轮 fixture 或更新该验收断言。

主线程已完成本批正式皮肤菜单、400×176几何、重度警告、保存重试、持续unknown手动查询、准备关闭/换来源及刷新验证；具体记录与截图见[本批实机验收](LOCAL-SKIN-AGENT-20261005.md)。上述清单中未列为实际观察的Topaz/Magnific全部状态不因本次皮肤验证而视作完成。
