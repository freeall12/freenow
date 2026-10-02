# 生成历史的媒体来源恢复

历史侧栏沿用 `reference/generation-history-20261002.md` 捕获的官方筛选、真实日期、预览及批量应用语义；共享预览的模型、日期、提示词来自该结果的保存记录，见 `reference/media-preview.md`。

- 图片归档和原输出恢复优先读取 `fullImage`，再读取 `image` / `url`，与共享媒体来源解析一致。下载及再次插入使用已归档的全尺寸媒体，不用缩略图替代原图。
- 供应商明确返回的 `output.model` 优先于请求的 `parameters.model/modelId`；持久化允许保留该字符串，刷新后重试归档仍使用原输出。请求参数继续保存原值。
- 预览和重新应用图片 / 视频时，把任务 ID、请求类型、原提示词、实际模型绑定到转成 data URL 的媒体，并恢复真实创建日期。修改下一次生成设置不能改变该媒体的来源。媒体地址替换后，旧来源不再提供模型。
- `video.analyze` 与包含 `sourceRange` 的裁片保存为分析来源，预览省略生成模型；描述模型不能显示为视频生成模型。历史不会为旧导入媒体或空项目补造任务。
- 创建时间仍保存为 UTC ISO 并按实际时间倒序；侧栏日期分组按浏览器本地日历日，和共享预览的本地日期一致。类型与文本筛选不变，没有增加日期过滤或改写原收据。

聚焦回归：

```sh
node --test tests/generation-history.test.cjs tests/media-preview.test.cjs
```

可重复的隔离浏览器入口：

```sh
node scripts/build-generation-history-fixture.cjs
# 打开 /qa/generation-history-app.html?session=<独立会话名>
```

`qa-controls.mjs` 只允许该精确路由与匹配的 Canvas / LocalAssets namespace。它用 Canvas 绘制真实 1200×800 PNG 与 300×200 缩图，直接走历史收据与归档接口，明确标注未调用模型；不会连接供应商或创建伪造的模型任务。重复点击保留该项目既有记录，刷新继续使用相同 session；不清空存储。

`generation-ui.js` 可能在解析后续 `local-assets.js` 前动态加载历史。默认素材服务尚未存在且文档仍在解析时，`install()` 等待 `DOMContentLoaded` 后才捕获服务，避免整个项目持有 undefined；素材脚本加载失败则明确报错并允许重试安装。已经留下的失败历史保留原任务与原媒体，使用“重试原图片归档”或侧栏“重试归档”恢复，不重新提交模型。

点击“保存合成高清历史”后刷新，用“读取持久历史与节点来源”确认持久化。打开左侧历史预览，再应用到画布，检查 1200×800、`QA 返回模型标记`、原提示词及真实日期。点击“修改已插入节点的下次参数”后再次双击预览，检查器中的 `sourceBound` 应为 true，`previewModel/previewPrompt/previewCreatedAt` 应保持原记录。下载落盘和真实供应商调用需要独立证据，本模块的 Node 回归不代替它们。分析视频省略模型的回归由现有 `video.analyze` 测试覆盖。

普通生成占位回填和显式任务恢复也保留独立 `image` 缩图与 `fullImage` 原图，防止覆盖全尺寸来源；相关回归：

```sh
node --test tests/generation-results-workflow.test.cjs tests/generation-recovery-integration.test.cjs
```
