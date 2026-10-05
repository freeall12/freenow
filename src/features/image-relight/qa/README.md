# 图片重新打光：隔离前端验收

使用正式 `image-relight-ui.mjs`、Three 预览、`generation-ui.js` 和 TaskService。公开合成陶瓶是测试素材，供应商返回的陶瓶 PNG 只是接口边界响应，不证明模型打光效果。

## 启动

```sh
env -i PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node src/features/image-relight/qa/server.cjs 0 pipeline agent
```

打开输出的 URL。`pipeline` 使用正式 routed 网关、`openai-relight-native`、已安装的 OpenAI SDK、图片归档和临时独立任务目录；仅精确 `https://api.openai.com/v1/images/edits` 供应商边界使用合成响应，其余供应商网络均拒绝。`agent` 插入正式 Agent UI 的固定模型回复夹具，审批、工具、任务回执与保存仍由生产代码执行。

不传 `pipeline` 时为浏览器 API 边界模式，可用于未配置、迟到配置、关闭准备和换源；不要把此模式当作真实网关验证。该模式生成结果直接使用公开合成 PNG。

默认固定 session 为 `relight-frontend-1005`，也可加 `session=<独立名字>`。偏好只在内存中；IndexedDB 使用此 session 的独立前缀。相同源、端口及 session 刷新后保留源资产和结果；夹具不会重新写入已有完整源图。服务重启另建临时任务目录，历史任务归档恢复由 root 的网关集成测试覆盖。

夹具的 `localStorage` 仅在内存中，刷新会清空浏览器任务索引，因此 controls 中的 `jobs` 可能为空。源图、结果像素、画布和服务端归档仍可持久保留；这些证据不能用来声称 TaskService 的任务列表或应用目标已跨刷新恢复，后者需要独立持久索引与恢复测试。

初始合成源图使用真实 PNG data URL，导入 LocalAssets 时进入撤销历史的原始图片也保持有效。已运行的旧夹具及旧 session 不自动重写历史、不清空数据；最终截图应使用新服务端口或新 session 验收该修复。

源图处理保留实际像素尺寸。服务器支持的静态 RGB/RGBA PNG 可保留原字节；其他静态 PNG、包含 tRNS 或 zTXt/iTXt/iCCP 的 PNG，以及 JPEG/WebP 会经过浏览器完整解码并转 PNG。canvas 可能进行色彩空间转换，不保证原编码、元数据或 ICC 色彩原样；APNG 仍明确拒绝，不默取首帧、不缩图。

## 操作验收

- 缺 Key：检查可见原因、生成禁用、模型提交为 0；仍可检查真实 Three 预览和全部本地控件。
- 正面 / 透视、6 个快捷光位、亮度和色温轨道及数值拖动、独立轮廓光：参数沿原 core 规则保留，26 个标准方向由预览拖动吸附。
- 后方光关闭并禁用轮廓光；回到前方不自动开启。重置恢复默认参数并保留当前视角。
- 延迟配置：先延迟下一次查询，再尝试生成；关闭或改变完整源图后释放迟到查询，应无模型提交及新结果。
- pipeline 下标记下一次保存失败，点正式生成：保留一个真实结果；任务标记结果应用失败。点重试原结果保存后，模型 POST 数与节点数保持不变。
- `/api/generation/fixture-audit` 记录实际 SDK POST、源图字节数、完整光照提示词字段和归档条目数；不含 Key 或用户资源。

## 当前验证

2026-10-05 专项：

```sh
node --test src/features/image-relight/qa/frontend.test.cjs tests/image-relight.test.cjs
env -i PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node --test src/features/image-relight/qa/server.test.cjs
```

前端/原参数测试 16/16；实际 HTTP、SDK multipart、routed 网关及归档测试 1/1。覆盖所有 26×3×6 参数组合、非法轮廓光显式拒绝、项目/对象/id/完整源/选区身份、缺配置不读媒体、准备取消与迟到 bitmap 释放、保存失败复用同一结果、受支持 PNG 原字节保留、JPEG/WebP及非原生 PNG 原尺寸转换、tRNS与三种压缩元数据 chunk 规范化、APNG显式拒绝，以及初始合成图进入撤销/重做历史后迁移诊断为 0。

CUA 已核验缺 Key 禁用、真实 Three 纹理、正面/透视、后方光限制与重置，以及 pipeline 的真实 SDK/归档、保存失败后正式按钮重试、配置迟到/换源零派发和完整 Agent 审批。Agent回执先保存、一次SDK POST、实际768×512结果及会话原任务ID刷新已验；新种子无迁移提示。刷新还发现正式入口的LocalAssets初始化竞态，修正顺序后的新宿主512×320源图刷新解码通过。详细输入、截图与限制见[本批验收](../../../../docs/LOCAL-RELIGHT-AGENT-20261005.md)。本夹具未验 TaskService 的跨刷新任务恢复；没有使用真实Key、用户素材或付费模型。
