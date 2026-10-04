# 视频模块目录整理（2026-10-04）

根目录的 23 个视频源码/样式文件实际迁入 `src/features/`，不保留根目录转发壳。功能、模型接口地址、节点坐标、存储身份和图标来源保持既有合同。生成服务仍需单独配置供应商。

## 文件位置

| 原根路径 | 当前路径 |
| --- | --- |
| `video-analysis-ui.mjs` | `src/features/video-analysis/ui.mjs` |
| `video-capture-core.mjs` | `src/features/video-capture/core.mjs` |
| `video-creation-core.mjs` | `src/features/video-creation/core.mjs` |
| `video-creation-ui.mjs` | `src/features/video-creation/ui.mjs` |
| `video-frames.mjs` | `src/features/video-media/frames.mjs` |
| `video-history-core.mjs` | `src/features/video-history/core.mjs` |
| `video-history-icons.mjs` | `src/features/video-history/icons.mjs` |
| `video-history-ui.mjs` | `src/features/video-history/ui.mjs` |
| `video-history.css` | `src/features/video-history/styles.css` |
| `video-mask-core.mjs` | `src/features/video-mask/core.mjs` |
| `video-mask-icons.mjs` | `src/features/video-mask/icons.mjs` |
| `video-mask-ui.mjs` | `src/features/video-mask/ui.mjs` |
| `video-reshoot-core.mjs` | `src/features/video-reshoot/core.mjs` |
| `video-reshoot-icons.mjs` | `src/features/video-reshoot/icons.mjs` |
| `video-reshoot-stage.mjs` | `src/features/video-reshoot/stage.mjs` |
| `video-reshoot-ui.mjs` | `src/features/video-reshoot/ui.mjs` |
| `video-segmentation.mjs` | `src/features/video-mask/segmentation.mjs` |
| `video-tools.js` | `src/features/video-tools/entry.js` |
| `video-trim-core.mjs` | `src/features/video-trim/core.mjs` |
| `video-trim-ui.mjs` | `src/features/video-trim/ui.mjs` |
| `video-upscale-core.mjs` | `src/features/video-upscale/core.mjs` |
| `video-upscale-icons.mjs` | `src/features/video-upscale/icons.mjs` |
| `video-upscale-ui.mjs` | `src/features/video-upscale/ui.mjs` |

## 引用与维护

主入口、生产按需导入、组件库 facades/catalog、服务端分割适配器、Agent 媒体工具、公开 QA 页面与定向测试同步更新。历史 UI 的样式通过模块相对 URL 读取，经典脚本的动态导入相对脚本文件解析；真实媒体输入仍使用页面 base URL。已有四项编辑器 bundle 不引用这些迁移文件，本批无需重新构建。

README、项目结构和开发指南已列明功能目录；其他根目录旧业务模块尚待各自功能迁移，不以这一批代表全库整理完毕。

## 验证

- 搬迁后的 39 处相对源码/样式引用存在性检查通过；当前生产与文档消费者不再引用旧视频路径。
- `pnpm check`：674 个 JavaScript 模块语法通过；`git diff --check` 通过。
- 视频与关联媒体/Agent 定向运行包含 205 项。初次运行 181 项通过，24 项 Agent 视频解析用例因原 VM 夹具缺少 `localProvider` 绑定失败；夹具显式标明自定义 provider 后，单独重跑该文件 33 项全部通过。生产预检逻辑未因测试修改。
- Computer Use：隔离页面导入本机合成 MP4/PNG，正式历史面板正常打开；键盘切换到第二批次展示两张卡片，Escape 关闭并返回历史按钮焦点。正式剪辑按钮动态加载新路径模块，展示剪辑选区、入出点和确认/智能剪辑控制。
- 新样式路径返回 `200 text/css`，浏览器截图确认历史卡片与批次布局；合成媒体属于 QA，不是模型生成结果。未调用供应商、未运行全库测试，也未重复构建无关编辑器。
