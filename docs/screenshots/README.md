# 功能截图与复现

2026-10-03，通过 Computer Use 在本机 4173 服务中操作正式界面并截图。图片不来自官方网站，也没有生成式修图；这些截图只展示本地实现。发布版本使用后台浏览器默认的 1280×720 视口，不代表全部响应式布局验收。

| 文件 | 实际内容 | 数据来源 |
| --- | --- | --- |
| [canvas.jpg](canvas.jpg) | 文本、图片参考、连线、编辑器和片场节点 | 公开示例简报、两个几何图层与仓库内模型缩略图 |
| [image-editor.jpg](image-editor.jpg) | 正式 Fabric 编辑器，选中前景图层后的操作栏 | 示例矩形和圆形；非生成图片 |
| [studio.jpg](studio.jpg) | 正式 Three.js 片场，GLB 导入、保存、聚焦和场景树 | `assets/studio/library/chair-office.glb`，实际 WebGL 渲染 |
| [agent.jpg](agent.jpg) | 正式 Agent 欢迎建议、输入、附件、确认及模型控件 | 空白示例会话；没有真实模型响应 |
| [video-trim.jpg](video-trim.jpg) | 正式智能剪辑输出三段视频、时长和来源连线 | 仓库内红绿蓝测试片，本机 FFmpeg 实际输出 |
| [agent-disabled-model.jpg](agent-disabled-model.jpg) | 2026-10-04 正式生成模型菜单的原因覆盖层（局部截图） | 模块内隔离选项；零选择回调、零模型派发 |
| [agent-duration-escape.jpg](agent-duration-escape.jpg) | 2026-10-04 首次Escape取消后保留时长浮层（局部截图） | 同模块隔离选项；恢复5秒、0次选择回调 |

不包含私人画布、账号抓包、API Key、聊天内容或供应商生成质量宣称。旧参考标识仍按 README 的最终品牌阶段处理；模型来源与第三方许可按原资产记录保留。

## 重现

启动正式服务后，生成与当前 `index.html` 同步的演示入口：

```sh
node scripts/prepare-screenshot-demo.cjs
```

打开 http://localhost:4173/docs/screenshots/demo.html?session=manual 。更换 `session` 得到独立示例数据库；不要附加 `project` 参数。演示使用独立 IndexedDB 和内存偏好，不读取日常画布、素材或会话。API 派发在该演示页禁用，不用于验证真实供应商或剪辑服务。

1. 点“重置”适应当前窗口，截取画布。
2. 点“AI 助手”，待展开动效结束后截取欢迎页，再收起。
3. 点“打开编辑器”，选择“前景形状”图层后截取；关闭编辑器。
4. 点“进入片场”→“导入模型”→“上传模型”，选择仓库中的 `chair-office.glb`，点“添加到场景”。等“模型已添加并保存”后聚焦，取消选择，收起镜头预览，切换“场景”页后截图。

`demo.html` 由生产入口派生，不另写一套产品 UI。修改入口加载顺序后重新执行脚本；修改示例只编辑 `demo-fixture.js`。截图属于文档资源，不进入正式项目初始化数据。

视频截图使用另一个[剪辑隔离 QA](../../src/features/video-trim/qa/main.html)：打开选区后收起验收面板，从正式视频工具栏重新进入剪辑，点“智能剪辑”。实际输出为 2.2、1.8、4 秒三段；读取后收起验收面板，点“重置”适应内容。该页允许本机 FFmpeg 接口，不调用生成模型。具体保护与验证见[剪辑结果恢复](../VIDEO-TRIM-RESULT-RECOVERY-20261003.md)。

Agent 模型反馈截图来自 `/src/features/agent-generation/qa/disabled-model.html`，使用真实生产菜单。鼠标进入禁用行出现原因，离开撤销；键盘焦点、点击禁用项、Escape与外部关闭的复验见[专项记录](../AGENT-GENERATION-DISABLED-MODEL-HOVER-20261004.md)。

时长取消截图来自 `/src/features/agent-generation/qa/duration-dismissal.html`；输入19后Escape，恢复5并保留浮层。实际第二次关闭、Enter提交及音频取消blur回调的结果见[专项记录](../AGENT-GENERATION-DURATION-ESCAPE-20261004.md)。

2026-10-04新增：`canvas-final-drop.jpg` 来自生产连线隔离QA的普通不兼容回退菜单，诊断同时证明菜单打开而原图不变；`studio-numeric-draft.jpg` 来自正式WebGL片场/运镜编辑和Agent，使用隔离精确坐标夹具与本机目录引用。见[连线](../CANVAS-CONNECTION-FINAL-DROP-20261004.md)、[片场数字草稿](../STUDIO-V2-NUMERIC-DRAFT-20261004.md)、[目录导航](../AGENT-REFERENCE-FOLDER-NAVIGATION-20261004.md)。没有调用真实模型。

`studio-meshopt-local.jpg` 为上述数字QA通过正式文件选择/上传模型添加仓库tree.glb后，刷新重入并聚焦的实际画面；树的压缩字节本机解码，未调用模型API。

2026-10-05新增，均为主线程Computer Use、默认1280×720本地画面，未调用生成接口：

| 文件 | 来源与已验证行为 |
| --- | --- |
| [image-alignment-guides-20261005.jpg](image-alignment-guides-20261005.jpg) | `src/features/image-editor/qa/alignment.html`，实际Fabric左边缘拖动，截图保留隔离诊断；另验半倍中心、撤销和刷新恢复 |
| [agent-message-attachments-20261005.jpg](agent-message-attachments-20261005.jpg) | `src/features/agent-messages/qa/agent-message-attachments.html`，正式消息renderer，真实本地图片/测试视频及失败槽位；另验重绘和会话持久化 |
| [studio-timeline-key-drag-20261005.jpg](studio-timeline-key-drag-20261005.jpg) | `src/features/studio-v2/qa/timeline-key-drag-main.html`，真实GLB与正式运镜，取消与同名片段切换后轨道未污染 |
| [canvas-history-batches-cua-20261005.jpg](canvas-history-batches-cua-20261005.jpg) | 公开隔离clone的4298正式入口，真实右键批次展开；整组一次撤销/重做和刷新恢复 |

历史隔离clone复现脚本见[专项记录](../CANVAS-HISTORY-EXPANSION-20261005.md)。这些证据覆盖上述具体行为，不等于全站同态视觉或真实供应商质量验收。

本批新增：

| 文件 | 来源与验证范围 |
| --- | --- |
| [image-editor-layer-menu-20261005.jpg](image-editor-layer-menu-20261005.jpg) | `src/features/image-editor/qa/layers.html`，正式Fabric图层菜单；真实PNG、上下移/复制/删除、键盘及迟到clone保护 |
| [agent-streaming-code-controls-20261005.jpg](agent-streaming-code-controls-20261005.jpg) | `src/features/agent-messages/qa/code-stream.html`，正式streaming/message renderer；本地增量文字，不是模型生成 |
| [studio-focus-navigation-speed-20261005.jpg](studio-focus-navigation-speed-20261005.jpg) | `src/features/studio-v2/qa/focus-navigation-speed-main.html`，真实GLB/WebGL片场；树选择、F、聚焦与全景速度保持 |

[高清素材往返截图](library-original-roundtrip-20261005.jpg)来自 `src/features/library-asset-roundtrip/qa/roundtrip.html`：正式保存/picker及刷新后两张2048×1152原图；128×72预览和真实PNG下载Blob已核对。QA偏好/收据/媒体均独立IDB，不代表正式素材库已迁移；浏览器下载落盘未确认。

[视频素材往返截图](library-video-roundtrip-20261005.jpg)来自同一隔离入口：真实本地原文件为4秒320×180、clip .5–2.5；正式下载经本机FFmpeg输出3256字节、2秒320×180，画布真实导出节点与连线渲染。未调用供应商模型，下载落盘不在证据范围。

## 2026-10-05 官方合同核验与 freenow

- [24类操作配置状态](generation-readiness-routed-20261005.png)：使用正式配置函数、隔离公开metadata、真实滚动/关闭和小窗口按钮可达性。
- [freenow 多角度原生替代面板](freenow-multi-angle-native-20261005.png)：本地 F 标识、原滑杆范围与专用模型限制说明；源图为仓库合同PNG，不是模型生成效果。

复现与接口边界见[交叉核验记录](../OFFICIAL-CROSSCHECK-AND-KEY-READINESS-20261005.md)。

## 2026-10-05 本地品牌与资源刷新

以下均为1280×720实际Computer Use截图，无生成式修图、私人内容或供应商生成请求。

| 文件 | 来源与验证范围 |
| --- | --- |
| [freenow片场Agent入口](freenow-studio-agent-brand-20261005.jpg) | 正式入口派生的独立generation-config QA中，新建3D片场并进入真实WebGL；两处Agent图片30×30、加载正常，按钮尺寸保持 |
| [freenow本地模型预览](freenow-local-model-preview-20261005.jpg) | 同一独立页面正式上传`assets/studio/library/bicycle-city.glb`并进入预览；真实自行车、环境控件和本地F提示标识 |
| [多角度素材刷新](local-assets-refresh-20261005.jpg) | `generation-config/qa/main.html?session=readiness-local-assets-1005b&profile=angle`刷新后；两张本机合同PNG经真实LocalAssets归档，源坐标100.25/80.5不变，无待本地化提示；不是模型效果 |

ElevenLabs Music 的正式参数、生成、播放和刷新已完成浏览器交互验收；该临时入口截图尺寸异常，未发布无效截图，也未据此声明音乐像素验收。实际媒体与请求范围见[Music专项](../elevenlabs-music-native.md)。
