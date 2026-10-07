# freenow 仓库发现性与引用指南

本文为公开仓库的 README、文档与 metadata 提供统一表述。freenow 是本地 AI 创作工作台（local AI creative workspace / AI infinite canvas），在一个工作区组织文本、图片、视频、音频、3D 片场与创作 Agent。

这里的 GEO 指生成式搜索/回答系统可理解、定位和引用的公开信息。SEO 指搜索引擎可检索的内容与页面信息。本地 `localhost` 页面不等于公开网站；仓库文档改善的是公开内容的清晰度与可引用性，不能直接证明收录、排名或转化提升。

## 建议的仓库 metadata

以下为建议值；修改 GitHub description/topics 由仓库维护流程单独执行。

**Description（English）**

> Local AI creative workspace with an infinite canvas, image/video/audio tools, a 3D studio, and a creative agent. Configure independent model providers; store projects locally.

**中文一句话**

> freenow 是本地 AI 创作工作台，用无限画布连接图片、视频、音频、3D 片场和创作 Agent。

**Topics**

```text
ai-creative-workspace
infinite-canvas
ai-agent
image-editing
video-editing
audio
3d-studio
threejs
javascript
local-first
```

只使用与源码和文档一致的主题。当前没有统一覆盖全部内容的开源许可证，不使用 `mit` 或 `fully-open-source` 表述；桌面包尚未发布时不使用下载数量、平台完成度或发布徽章。

## 可引用的项目事实

| 问题 | 简明答案 | 可核对来源 |
| --- | --- | --- |
| freenow 是什么？ | 本机运行的 AI 无限画布与创作工作台 | [中文 README](../README.md)、[English README](../README.en.md) |
| 如何运行？ | Node.js 服务同时提供页面与本机 API，默认 `127.0.0.1:4173`；推荐 Node.js 22 LTS / pnpm | [启动指南](../README.md#快速开始)、[服务入口](../server/server.cjs)、[package.json](../package.json) |
| 没有 Key 能用吗？ | 本地编辑可用；Agent 与生成需要配置，部分媒体操作需要 FFmpeg | [最小配置](../README.md#最小-api-配置)、[开发指南](DEVELOPMENT-GUIDE.md) |
| 数据保存在哪里？ | 浏览器 IndexedDB/localStorage 与服务端私有任务/媒体目录；没有云同步 | [本地数据](../README.md#本地数据与隐私)、[存储说明](LOCAL-STORES-AND-RUNTIME-20261003.md) |
| AI 请求完全本地吗？ | 不保证；配置的供应商接收所需提示词/媒体，仓库不附带本地推理模型 | [运行边界](LOCAL-RUNTIME-BOUNDARIES-20261003.md)、[供应商配置](MULTI-PROVIDER-SETUP.md) |
| 如何确认功能已完成？ | 阅读专项源码、媒体和浏览器证据，区分接入、局部验证与未验范围 | [功能与适配器](FEATURES.md)、[验收索引](VERIFICATION-INDEX.md)、[状态](STATUS.md) |
| 许可证是什么？ | 当前没有覆盖全部内容的统一开源许可证；第三方代码与参考资源保留原权利边界 | [第三方资源](THIRD-PARTY-RESOURCES.md) |

## 术语与命名

- **无限画布 / infinite canvas**：平移缩放的节点工作区，用节点和连线组织素材与创作流程。
- **3D 片场 / 3D studio**：可编辑场景、对象、相机与运镜；与只保存资源的 `world` 节点区分。
- **SPZ / Gaussian Splatting / 高斯世界**：已有本地渲染与 LOD；不等于完整 GLB 导出、驻留内存上限或所有设备性能保证。
- **creative agent / 创作 Agent**：通过工具操作本地创作对象的模型流程；需要符合 Responses API/工具合同的服务。
- **local-first / 本地优先**：项目与结果主要保存本机，AI 生成仍可访问外部供应商；不等于无网络请求。
- **native adapter / 原生适配器**：依据独立供应商公开协议实现；替代服务、提示词模拟与自定义任务合同需明确标识。

这些术语用于解释具体对象，不在标题、alt 文本或正文中反复堆砌。README 截图 alt 说明真实页面，详细验证链接说明来源与边界。

## README 信息架构参考

2026-10-07 仅通过公开 GET 阅读下列项目的 README 与 GitHub API metadata，没有使用账号、Cookie 或私有页面。前两项是高星相关 AI 工作台；MyGo 是用户指定的桌面技术参考，其声明不代表 freenow 已具备相同打包能力。

| 参考 | 本次观察 | 借鉴到 freenow 的结构 |
| --- | --- | --- |
| [ComfyUI README](https://github.com/Comfy-Org/ComfyUI/blob/170594057a22673349ddf0a3d88624b7fa5865bb/README.md) | 图/节点模型工作区；产品定义、界面示例、安装方式、模型/功能细节与 QA；API 星数快照 136,372 | 先说明画布对象和使用条件；最短启动后链接配置与开发细节 |
| [Open WebUI README](https://github.com/open-webui/open-webui/blob/3572e01a71c2809bf482771ff2809fb6c6778f91/README.md) | 自托管 AI 界面；实际演示、核心能力、安装、数据持久化提醒与分节许可；API 星数快照 154,119 | 把使用入口、数据位置、排错和许可放在可定位位置 |
| [MyGo README](https://github.com/egoist/mygo/blob/c8e0069c09c6b01f366a9f16d40b028b7c9ff258/README.md) | 桌面技术库；一段定义、两种运行形态、简短示例、Getting started 与文档；API 星数快照 823 | 明确运行形态与最小命令；桌面启动依据实际实现单列，不复制上游支持平台承诺 |

上游 README 与星数会变化；固定源码链接记录本次参考版本，星数只用于说明样本。未复用其营销文案、功能承诺、徽章或项目许可。

## 本轮落地与复验

- 中文/英文 README 使用相同产品事实、启动方式、配置边界和许可。
- [功能文档](FEATURES.md)承接长适配器表；[验收索引](VERIFICATION-INDEX.md)和[旧首页快照](README-HISTORY.md)保留历史证据。
- [文档导航](README.md)按使用、开发、状态定位；[项目结构](PROJECT-STRUCTURE.md)提供职责总览。
- 根 [llms.txt](../llms.txt)仅作为公开文档指针。它不是搜索引擎标准，也不保证被模型读取。
- 修改后检查相对链接、截图字节/跟踪状态、README 描述与脚本一致性，以及 `git diff --check`。本轮没有测量搜索排名、流量或所谓 SEO 分数。
