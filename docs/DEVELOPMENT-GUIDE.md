# 开发维护指南

本文用于定位代码、选择构建和验证范围。安装、配置及用户功能截图见[项目 README](../README.md)；逐模块说明见[项目结构](PROJECT-STRUCTURE.md)，文档索引见[docs/README](README.md)。以下路径和脚本按当前仓库接线编写。

## 宿主与依赖

- `server/server.cjs` 同时提供静态页面及 `/api/*`；默认仅监听 `127.0.0.1:4173`，可由 `PORT` 调整。不要用另一个静态文件服务替代它来验收生成、音视频处理或 Agent。
- `index.html` 是正式画布入口：经典脚本按顺序建立 `CanvasStore`、`CanvasApp`、`GenerationAPI` 等宿主，再接入按需加载的 ES Modules。根目录 `app.js`、`node-editor.js`、`generation-ui.js`、`agent-client.js` 仍是生产桥接，不能因新目录存在而删除或调整加载顺序。
- `package.json` 的 `type` 为 `commonjs`；服务端使用 `.cjs`，浏览器新模块使用 `.mjs`。Three 由 `index.html` 的 import map 映射到已安装的 `node_modules/three/`；服务端只公开这部分依赖目录，不公开整个 `node_modules/`。
- Fabric 与 Tiptap 经 esbuild 打包，OpenAI SDK 留在服务端，Tabler 用于有来源的图标资源。版本以 `pnpm-lock.yaml` 为准。FFmpeg/FFprobe 支持本机媒体处理，路径由 `FFMPEG_PATH` / `FFPROBE_PATH` 配置。
- `.env.example` 是配置字段说明，实际 Key 留在 `.env.local` 或启动环境。服务端不会自动加载 `.env.local`；需用 README 中的 `node --env-file=.env.local server/server.cjs` 启动。一次只运行一个服务实例；更换端口也不能绕过私有任务存储的单写者锁。

## 按功能找改动入口

先定位功能目录，再检查宿主调用与保存路径。表中“宿主”负责已有生命周期或事务，并不表示应继续向大文件追加业务逻辑。

| 修改对象 | 业务模块 | 需一起核对的宿主或接口 |
| --- | --- | --- |
| 画布项目、导航、多选、布局、连线 | `src/features/canvas-projects/`、`canvas-connections/`、`canvas-layout/`、`canvas-search/` | `app.js`、`canvas-store.js`、`project-context.js`、`canvas-navigation.js`；节点与边一次提交，复用撤销/保存 |
| 节点提示词、参考素材、生成浮层 | `src/features/node-composer/`、`canvas-reference-picker/`、`image-generation/`、`video-generation/` | `node-editor.js`；提交共同经过 `src/features/node-composer/generation-request.mjs` 与 `generation-api.js` |
| 生成请求、结果布局、错误、历史 | `src/features/generation-results/`、`generation-history/`、`video-history/` | `generation-ui.js`、`server/generation.cjs`、`generation-durable.cjs`；结果保存后才确认已应用 |
| 图片文档、蒙版及关联输入 | `src/features/image-editor/` 与根目录 `image-*-core.mjs` / `image-*-ui.mjs` | `image-editor-entry.mjs`、`image-mask-entry.mjs`；改对应打包入口后重建产物 |
| 文本节点、引用和编辑器 | `src/features/text-generation/`、`text-editor-entry.mjs` | `canvas-text.js`、`canvas-text-ui.js`、`text-generation-ui.js`；正文/引用/连线保存是一条事务链 |
| 视频创建、解析、剪辑、蒙版、重拍与增强 | `src/features/video-creation/`、`video-analysis/`、`video-trim/`、`video-mask/`、`video-reshoot/`、`video-upscale/` | `src/features/video-tools/entry.js`；取帧共用 `video-capture/` / `video-media/`，历史样式放 `video-history/` |
| 音频、音色、字幕结果 | `src/features/audio-voices/`、`audio-subtitles/`、`agent-generation/audio.mjs` | `audio-core.js`、`audio-ui.js`、`server/generation-audio-subtitle.cjs`；字幕按源音频/任务身份更新 |
| 分组运行和刷新恢复 | `src/features/workflow-recovery/` | `workflow-core.js`、`workflow-ui.js`、`GenerationAPI`、`CanvasStore`；先登记原任务再派发 |
| Agent 输入、流、消息、历史和队列 | `src/features/agent-composer/`、`agent-stream/`、`agent-messages/`、`agent-history/`、`agent-queue/` | `agent-client.js`、`server/agent.cjs`、`server/agent-stream.cjs` |
| Agent 工具执行、生成卡、继续中断任务 | `src/features/agent-execution/`、`agent-generation/`、`agent-recovery/` | `agent-tools.js`、`agent-client.js`、`server/agent-checkpoints.cjs`；保留确认、真实回执及来源校验 |
| Agent 应用、Widget、模板及 HTML 作品 | `src/features/agent-apps/`、`agent-widgets/`、`agent-artifacts/` | 应用 `host.mjs`、应用/Widget `integration.mjs`、作品 `store.mjs` 和 `agent-client.js`；读对应功能合同，不扩展共享 iframe 权限 |
| 主体库、素材读取和历史资源修复 | `src/features/subject-library/`、`local-resource-migration/` | `local-assets.js`、`project-context.js`、`CanvasStore`；修复需要精确来源和保存守卫 |
| 3D 资源预览、导入和独立片场 | `src/features/world-node/`、`studio-v2/` | `studio.mjs`、`studio-state.js`；`world` 是资源，`studio` 是可编辑场景，存储与导航规则分别维护 |
| 供应商协议、媒体处理和下载 | `server/generation-*.cjs`、`media.cjs`、`playlist.cjs`、`video-segmentation.cjs` | `server/server.cjs`；配置路由、任务持久化、落盘与出站策略分别核对 |
| 视频手动/智能剪辑与保存重试 | `src/features/video-trim/result-transaction.mjs`、`src/features/video-trim/ui.mjs` | `CanvasApp.createConnected/saveProject`、`LocalMedia`；归属与应用收据不依赖编辑器可见状态 |

新增业务放入 `src/features/<feature>/`，复用已有宿主接口；只有实际共享的逻辑才放入 `src/shared/`。根目录旧模块在修改对应功能时逐步拆分。`component-library/` 是复用目录及预览宿主，部分组件依赖画布状态、存储或服务，不是全体可独立移植。

## 构建表

项目没有通用 `build`、`lint` 或 `typecheck` 脚本。普通 `.mjs`、`.js`、CSS 修改由浏览器直接加载；只有下列入口及其打包依赖需要重建。

| 命令 | 源入口 | 产物与格式 | 常见触发改动 |
| --- | --- | --- | --- |
| `pnpm build:text` | `text-editor-entry.mjs` | `assets/text-editor.js`，IIFE | 文本编辑器与其 Markdown 渲染 |
| `pnpm build:image` | `image-editor-entry.mjs` | `assets/image-editor.js`，IIFE | Fabric 编辑器、关联图片和编辑器导入模块 |
| `pnpm build:mask` | `image-mask-entry.mjs` | `assets/image-mask.js`，ESM | 浮动蒙版引擎及其导入模块 |
| `pnpm build:agent` | `src/features/agent-composer/editor-entry.mjs` | `assets/agent-editor.js`，ESM | 共享 Agent/节点提示词编辑器、内联引用、共享 Markdown 解析 |

四项构建均使用已有 esbuild，`legalComments: 'linked'` 保留许可旁文件。不要手改压缩产物。`build:agent` 将主体库 store 保留为外部模块，确保编辑器与按需 UI 使用同一份存储缓存；不要把它重新打包成第二个实例。

`pnpm run setup` 只独占创建缺失的四份根数据文件，并校验/发布本机资源索引；已有数据不会覆盖。务必保留 `run`，`pnpm setup` 是包管理器自身的另一条命令。

## 定向验证与浏览器 QA

先跑变更相关测试，再按需构建与检查。下面是可直接使用的起点，不是每次改动的必跑清单。

```sh
# 画布导航或连线
node --test tests/canvas-navigation.test.cjs tests/canvas-connection-validation-performance.test.cjs

# 生成结果落盘、可读取性和任务终态
node --test tests/generation-media-materializer.test.cjs tests/generation-media-http.test.cjs tests/generation-media-durable.test.cjs

# 刷新后查询原任务、显式继续与应用收据
node --test tests/workflow-recovery-journal.test.cjs tests/workflow-recovery-host.test.cjs
node --test tests/agent-recovery.test.cjs tests/agent-recovery-journal.test.cjs

# 历史素材及 HTML 派生边界
node --test tests/node-image-repair.test.cjs tests/node-video-repair.test.cjs tests/node-audio-repair.test.cjs tests/html-document-migration.test.cjs

# 片场目录、分页及选中状态
node --test tests/studio-v2-scene-panel.test.cjs tests/studio-v2-scene-panel-snapshot.test.cjs

# 本机剪辑结果归属与保存重试
node --test tests/video-trim-result-transaction.test.cjs tests/video-trim-ui-ownership.test.cjs

node --check src/features/<feature>/<changed-module>.mjs
pnpm check
```

`pnpm check` 检查根目录 `.js/.mjs`、`server/` 与 `src/` 的源码语法；它不验证浏览器加载、DOM 交互、QA 脚本或打包产物。`pnpm test` 是全库 Node 回归，按关联范围或阶段需要运行。部分 DOM 测试通过已锁定 Fabric 的依赖访问 JSDOM，仍不能代替 WebGL、真实媒体解码或实际浏览器验收。

下列页面已纳入 Git，除媒体落盘专用 fixture 外均由正式本机服务提供静态文件。需先阅读页面提示或相邻 QA 说明；固定输出与私有测试存储只能证明所测链路，不代表真实供应商生成质量。媒体落盘演示另开隔离服务：

```sh
node tests/fixtures/generation-local-media-server.cjs --port 4174
```

在 `http://127.0.0.1:4174/qa/generation-local-media.html` 操作，不在正式 4173 服务中提交该 fixture 任务。它使用临时私有存储和内置合成 PNG，不读取真实 Key。

| 验证目标 | 浏览器路径（默认前缀 `http://localhost:4173`） |
| --- | --- |
| 通用媒体落盘演示 | `/qa/generation-local-media.html`；使用上述专用 4174 fixture 服务 |
| 分组查询、停止、明确继续 | `/src/features/workflow-recovery/qa/main.html`，详见该目录 `README.md` |
| 音频字幕绑定 | `/src/features/audio-subtitles/qa/main.html` |
| 旧会话/学习卡/图片修复 | `/src/features/local-resource-migration/qa/conversations.html`、`learning-previews.html`、`node-image-repair-main.html` |
| 旧视频/音频原位修复 | `/src/features/local-resource-migration/qa/node-video-repair-main.html`、`node-audio-repair-main.html` |
| 片场对象树、点选、导出 | `/src/features/studio-v2/qa/scene-panel-main.html`、`picking-main.html`、`scene-export-main.html` |
| 视频历史、首尾帧输入校验 | `/src/features/video-history/qa/history-main.html`、`/src/features/video-generation/qa/reference-validation.html` |
| Agent 应用的真实宿主接线 | `/src/features/agent-apps/qa/<app>.html`，例如 `ad-review.html`、`template-source.html` |
| 互动 HTML 的导出与退出 | `/src/features/agent-artifacts/qa/local-export.html`、`preview-escape.html` |
| 模块复用边界 | `/component-library/` |

根目录 `qa/` 默认被 `.gitignore` 排除，只有显式例外公开；开发机上的旧 `*-app.html` 不能假设公开克隆存在。新增可复现验收优先放对应功能的 `qa/`，用独立数据库/前缀、显式合成数据及固定响应；不要复用用户数据库或真实供应商 Key。正式入口不得注入 QA provider 或 fixture。主界面和目标 QA 都应检查中文换行、焦点返回、取消/换源、保存失败、刷新和第二页面竞争。

## 生成适配与恢复约定

生成链路为：节点/Agent 请求准备 → `generation-api.js` → 本机 `server/generation.cjs` → 服务端供应商路由 → 持久任务/媒体 → `generation-ui.js` 应用 → 画布保存。配置、模型映射和真实外网调用只在服务端；协议及结果字段见[生成网关](GENERATION-GATEWAY.md)和[路由合同](generation-routing-contract.md)。主入口当前强制本地资源 CSP；不能通过移除边界来兼容远程结果，应走既有服务端落盘。

- 新适配器沿用现有任务 ID、配置版本、取消与恢复合同；能力预检应准确报告未配置/不支持，不能把固定测试结果当成功回退。
- 供应商完成、媒体落盘、前端可解码、画布保存是不同阶段。UI/Agent 必须用共同结果应用路径，按真实 taskId 与来源版本过滤取消和迟到结果；`succeeded` 不能直接认定“已写入画布”。
- 生成任务恢复查询原 taskId；unknown、404 或提交状态不明不能重 POST。来源变化、任务身份或应用回执不足时保留记录并明确阻断。
- 分组刷新后先查询原任务；未提交层由用户明确继续。同层并行、整层完成后推进，停止只阻止后续提交。调用 journal 写入必须 `await`，原任务登记/请求签名成功持久化后才派发；画布保存与 applied 收据成功后才推进。
- Agent 恢复只核对同一 session/binding，`waiting_tools` 不授予执行权。继续须有完整真实回执与原来源签名，不从摘要推导、补造或重复执行旧工具。合同见[分组恢复](../src/features/workflow-recovery/README.md)、[Agent 恢复](../src/features/agent-recovery/README.md)。

## 资源来源、派生与存储边界

| 位置或引用 | 内容与维护约定 |
| --- | --- |
| `src/`、根入口、`server/` | 生产源码；业务实现与宿主事务分工明确 |
| `assets/`、`runtime-reference/`、应用 `resources/` | 经审阅的运行资源、编辑器产物与最小参考材料；保留许可和来源，不赋予模板执行权限 |
| `reference/` | 开发机原始捕获及历史证据，默认不公开；公开克隆不保证历史文档的这些链接可打开 |
| `defaults/` → 四份根数据文件 | 可公开的空默认数据 → 本机初始化数据；根数据文件被忽略，不提交用户画布/素材/版本 |
| CanvasStore 的 IndexedDB | 默认库 `tapnow-canvas-replica` / `documents`；包含项目画布、Agent 会话及分组记录，事务版本与宿主身份校验不能绕过 |
| LocalAssets 的 `asset:` | 默认库 `tapnow-local-assets` / `assets` 保存 Blob；`blob:` 是当前页面读取句柄，不是持久跨刷新身份 |
| Agent artifacts 的 IndexedDB | 默认 `tapnow-canvas-replica-artifacts`；作品内容与 revision 独立保存，导出不能覆盖原文 |
| `server/.generation-tasks/`、`.generation-media/`、`.agent-sessions/` | 私有任务、媒体和服务端会话；忽略于 Git，静态路由禁止读取 `server/`；生成媒体只通过专用 `/api/generation/media/<UUID>` 获取 |
| `assets/local-resource-index.json` | 本机派生索引，忽略于 Git；完整原来源字串摘要 → 本地文件字节/SHA，哈希索引仍属于私有资料 |

浏览器数据属于 origin；`localhost`、`127.0.0.1` 和不同端口可能拥有不同存储，浏览器换入口后出现空项目不等于服务端已丢数据。排查时先核对完整地址、项目身份和数据库，再使用导出/导入或已有修复入口，不清空用户存储。

历史资源迁移只修改明确槽位，完整原来源字符串按 UTF-8 SHA-256 查表，验证本机 MIME、长度、字节哈希及真实解码。未知来源保留待导入状态，不自动回源、不按文件名匹配、不递归替换任意 URL。画布、会话、主体与学习卡保存还须验证原项目、版本及异步提交资格；说明见[迁移底层](LOCAL-RESOURCE-MIGRATION.md)。

HTML 本地预览/导出属于只读派生：保留原文与 sourceHash，绑定宿主 artifact revision / frame nonce，隔离运行；`pending_import` 不能标为完整离线。应用原 HTML 的窄传输修正必须以完整原 SHA 校验，不直接改掉采集原件。具体边界见[HTML 派生合同](HTML-RESOURCE-DERIVATION.md)、[第三方来源](THIRD-PARTY-RESOURCES.md)。`scripts/localize-*` 是依赖原始资料的开发工具，不是首次启动步骤。

## 小批交付

每批记录实际入口、行为变化、定向测试、浏览器证据和剩余限制，再提交聚焦 diff。提交前核对 `git diff --check`、`git status --short` 与暂存内容；源码入口与相关构建产物一起提交，排除 Key、本机存储、私人媒体与原始抓包。

区分“已有实现”“尚未验收”和“尚未实现/缺资源”。[当前功能缺口](CURRENT-FUNCTION-GAPS-20261003.md)保留初始审计，开头已说明音频字幕、学习预览迁移和分组恢复完成，不能重复按历史段开发。当前 `world-node/render-capabilities.mjs` 明确仅支持 GLB mesh，SPZ 落盘不是高斯渲染；Creative 现有模板编辑器也不等于已获得全部精确模板正文。外部模型质量、全站同态交互和这些资源缺口分别记录证据。
