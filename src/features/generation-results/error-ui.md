# 生成节点失败覆盖层

## 官方依据

- `reference/canvas-current-readable.js:12285–12291` 的 `bQ`：覆盖层绝对定位、继承圆角、z-index 30、背景 90%、模糊 8px、顶部留白 24px；内容左右 16px，间隔 12px。标签为 `common.tip`，真实错误原文，ghost/sm 确认按钮。
- 同文件 12527–12537：所有节点的公共 shell 根据 `data.taskInfo.error` 显示，确认仅将 `taskInfo` 清空。只读没有确认按钮。
- 同文件 10840–10858、10861–10887：生成异常先检查所属 run，再按对应目标写入 failed/error。轮询中断单独带 `pollingPaused`；没有依据将本地取消或配置缺失映射成该失败画面。
- `reference/vendor-packages-CN3JnHbF.js` 的 `cl=P0` 和 `b8=de` 为标签和按钮的实际组件；`reference/original-index.css` 为颜色、圆角和字号实值。没有新增图标、文案装饰或重试按钮。

## 本地状态映射

本地没有复用官方 `taskInfo`。显示必须同时满足：

1. job.kind 为 `image.generate`、`video.generate` 或 `text.generate`。
2. `status === 'failed'`、`providerDispatched === true`，有非空字符串 `error`。
3. 不存在 `applicationError`。
4. `job.nodeFailures` 包含任务所有者在清理前签发的 `{node, signature}` 内存收据；当前节点对象和内容仍匹配。

`configuration_required`、`cancelled`、准备参数异常、结果解码/应用异常、无可靠目标所有权的失败均不映射。其任务队列状态保持不变。本模块不猜测 API 的轮询恢复能力，也不从 request.nodeId 或历史 taskInfo 补造失败。

确认仅将该 job/目标的展示标识加入会话内 dismissed 集合；不调用 retry/cancel、不删除节点、不改状态、正文、媒体或历史。多目标错误可逐个确认。编辑、删除重建或后续新任务会使旧收据永久失效，避免撤销内容或取消新任务后旧错误复活。新任务失效目标同时包括 request.nodeId 和 canvasResults.targetNodeIds，覆盖保留源生成。

## 桥接契约

```js
import {failureSignature, captureFailureTargets} from './error-state.mjs';

// Task owner must validate run ownership AND the original content guard first.
// Run before clearing pendingOperation/generationRun.
storedJob.nodeFailures = captureFailureTargets(validatedLiveNodeObjects);
```

`failureSignature(node)` 稳定排序，仅忽略 `x/y/selected/pendingOperation/generationRun`。收据保存真实对象引用，不得 JSON 持久化或从请求参数重建。planned targets 需要 `app.getGenerationFailureTargets(runId)` 的严格身份与内容验证；unplanned variants 需要提交时对象引用和内容快照验证。`captureFailureTargets` 本身不替代这些所有权检查。

```js
import('./src/features/generation-results/error-ui.mjs').then(({install}) => install());
```

在 CanvasApp/GenerationAPI 建立后安装；自动加载同目录 CSS。返回 `{refresh(), destroy()}`，相同 CanvasApp 重复安装复用实例。可选 `readonly(node)` 禁止显示确认按钮。`destroy` 清理监听、DOM和展示状态；样式保留。收据由任务所有者提供，展示 dismiss 仅存在本次安装生命周期内。

覆盖层挂在 `.node-body`，不覆盖标题和连接口。普通拖动保留等待层 DOM和原媒体，缓存 body；viewportOnly 完全跳过。非 viewport 渲染仍从真实任务读取收据并校验节点内容签名，活跃错误多时存在数据扫描成本；没有每帧全节点 DOM 查询或轮询。在无有效失败收据时不构建节点索引。

## 验证

```sh
node --test tests/generation-error-ui.test.cjs
```

测试覆盖签名边界、状态分类、未签发收据拒绝、计划目标与保留源、逐目标确认、删除/编辑/新任务迟到保护、原始错误安全文本渲染、确认事件、只读、多媒体共用、拖动和缩放、shell重建、销毁以及空闲索引开销。实机视觉验收由入口接入后执行。
