# 公共工作流模板源码核对（2026-10-05）

核对对象是画布左侧的 10 份公共工作流模板，独立于 Agent 创意 HTML 和社区营销页面。

## 官方读取与数据

- `index-BsHyQ2qj.js` 字符偏移 720000–723000：`GET /api/canvas/v1/official-templates`；侧栏调用参数 `template_type=executable`、`with_template_data=true`、`offset=0`、`limit`，可选 `category_ids`，API 统一加入 `language_regions`。
- 响应 `data` 可以直接是数组，或 `{templates: []}`。标题从 `i18n_content.title` 回退到 `name`，说明从 `i18n_content.des` 回退到 `description`。
- 每项公开记录带 `id`、`name`、`preview_image`、`cover_media_type`、`created_at`、`tags`、`template_type`、`template_data: {nodes, edges}`。
- 详情读取 `GET api/conversation/v1/official-canvas-templates/{id}`；侧栏已有完整 `template_data` 时不需再请求详情。
- `course-api-base-url-CGXqZmAy.js` 字符偏移 2783000–2786200：公共列表分页/缓存、上述参数和标题归一化。

## 官方动作

- `course-api-base-url-CGXqZmAy.js` 字符偏移 2874200–2879500：卡片 hover 切换 40% 黑色遮罩并显示“查看 / 应用”，视频进入时播放、离开时暂停。**卡片整体或标题 click 直接应用**；“查看”阻止冒泡并单独打开模板库。
- `page-DVqoHdTT.js` 字符偏移 94280–100000：侧栏公共/我的标签、实时本地标题搜索、三列卡片、分页触底加载。
- 同文件 1555150–1556500：“查看”和“浏览全部”共用模板库 modal，关闭回侧栏；应用清理选择状态、关闭模板库并导入。
- 同文件 71600–86600：模板库 1100×700，左侧类别/最近使用/我的模板，右侧标题、搜索、创建、六列列表；详情展示 400×400 媒体、标题、原始创建时间、标签、说明、应用和其他模板缩略图；详情返回按钮回列表，Close 关闭模板库。
- 同文件 64500–67100：应用在客户端重映射 node ID、坐标和内部 edges，建立一个 workflow 分组并聚焦。`POST .../official-canvas-templates/{id}/apply` 是官方使用记录；本地复刻不调用它。

## 实施边界

只从上述公共模板读取接口获得数据；不读取用户私有画布、Cookie、Token、私有 IndexedDB，不向官方写入或运行模型。真实节点图和媒体落盘后接入本地 `TemplatesCore.instantiate` / `CanvasApp.insertGraph`，保留精确相对坐标、ID 重映射、撤销和本地项目上下文。缺失数据必须报告为失败，不能用封面图代替真实工作流。

浏览器观测由主任务统一执行。源码核对不能代替本地预览、应用、撤销和刷新验收。

## 公开媒体的实际来源规范化

下载旧 `files.tapnow.top` URL 时发生 TLS 超时。主任务在官方 `index-BsHyQ2qj.js` 的 `AUe` 媒体 URL 规范化函数中核对到：`LEGACY_PROD` / `files.tapnow.top` 以及 `app.tapnow.ai` 的 `/api/conversation/storage/uploads/` 地址，媒体 origin 规范化为 `RY()` 默认返回的 `https://files.tapnow.media`，path、query、hash 保持不变。离线归档只在无认证下载时使用这一源码确证规则。

资源映射键保留响应中的精确原 URL，映射值是归档后的本地 assets 路径。运行时清单不携带旧站回调、远程存储路由或原站凭据；预览和应用均只读取本地资源。
