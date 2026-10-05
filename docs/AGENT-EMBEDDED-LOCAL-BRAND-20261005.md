# 内嵌 Agent 应用品牌、外域资源与导出审计 · 2026-10-05

已核对 `resources/apps/manifest.json` 的 22 个运行版本、registry、共享/专属 proxy 与本地品牌导数。固定品牌文字和 Logo 的生产位置已有专用派生；本次补充三个选择器的实际导出边界文案，并替换制作进度 QA 新提交完成状态中的旧 Logo 测试图。没有新增依赖或访问原站接口。

## 本次改动

- `src/features/agent-apps/picker-local-presentation.mjs`：完整原 HTML SHA-256 匹配后，仅替换 Creative、Website、Motion v1 的固定 `exportNote`。中文为“此处提供交互预览；可录屏保存，暂不提供视频导出。”覆盖中、英、日、韩、法，Creative 同时覆盖静态默认文字与英文 fallback。没有承诺全部模板可以生成或导出 HTML。
- 三个选择器的源 HTML、模板 object_key/SHA、选择状态、确认消息及协议脚本保留。未知版本或任意源字节改变拒绝派生，其他应用原样返回。
- `qa/production-progress.mjs/.html`：新完成测试读取仓库已有 `assets/studio/library/chair-office.webp`，实际仍走 WebP 解码、Blob 提交与 data URI 预览。图片来源随测试媒体保存。历史已存测试图保留，来源标作历史本地 WebP；点击“提交本地测试完成状态”才更新图片。IndexedDB 名称不变。

`picker-local-presentation` 必须由生产共享 proxy 在原 HTML 读取完成后、`inner.srcdoc` 之前调用。模块定向验证通过不等于生产接线与浏览器视觉验收通过。

## 品牌与外域资源分类

| 检查位置 | 当前代码证据 | 处理 |
| --- | --- | --- |
| 制作进度生成/超时/打开项目/额度不足、页脚 Logo | `production-progress-local-brand.mjs`，专属 proxy 取本地 SVG 并嵌为 data URI | 现有 freenow 文字与本地标识；供应商额度文案准确 |
| 平台裁切免费提示与完成提示 | 共享 proxy `PLATFORM_RESIZE_LOCAL_BRAND` 完整 SHA 派生 | 现有本机裁切 / freenow 画布文字 |
| 商品组图计费确认 | 共享 proxy `ECOMMERCE_LOCAL_BILLING` 五语言精确目标 | 现有本地任务提交与已配置供应商实际计费文字 |
| 22 个 manifest 运行 HTML 中的固定 URL | 未发现固定原站图片/Logo URL；匹配到的绝对 URL 是 JSON schema、SDK 文档、SVG namespace、Three.js 论文或字体许可 | 保留来源与版权；文本里的 URL 不等于运行网络请求 |
| 图像与视频预览来源 | 本地 runtime 生成 host-owned data/blob；学习/个人素材模块 imageDomains 当前为空 | 本次未扩大 CSP 或接入原站 |
| 模板协议 | `ui://tapnow/*`、`tapnow/setWidgetState`、`tapnow/sendPrompt`、模板 skill 标识与合同消息 | 保留协议，不替换用户标题或合同正文 |
| 历史存储 | `tapnow-*` IndexedDB、localStorage key | 保留兼容，不清库 |
| Creative / Website / Motion 导出提醒 | 原五语言 `exportNote` 曾承诺 coming soon | 本次精确派生为当前预览、录屏与无视频导出 |

原始模板里的产品设计令牌注释、库许可证与学术来源没有充当 freenow 品牌显示位置。第三方作者和历史来源说明也不改写为 freenow。

## 实际导出链审查

- `agent-artifacts/local-export.mjs`：离线 HTML wrapper 的 title 来自用户作品，下载名来自 artifact_path；本地资源未完成时拒绝离线导出。没有固定 TapNow 标题或水印。用户自行命名 TapNow 的作品继续原样保留。
- `image-editor/agent-export.mjs`：Canvas 像素编码为 PNG/JPEG；下载回执只表示浏览器请求，不能证明文件已经保存。没有固定旧品牌图像水印。
- `studio-v2/scene-export.mjs`、`model-io.mjs`：GLB 下载名取当前用户场景名，Three.js 导出器负责序列化；没有固定 TapNow 文件名前缀。
- `studio-v2/motion-easing-io.mjs`：GLB sampler extras 的 `tapnow_easing_v1` 是导出再导入的缓动元数据合同，读取链仍使用同一个字段。品牌替换会损坏历史场景，故保留。
- `studio-v2/video-export.mjs`：真实 ShotRenderer → Canvas captureStream → MediaRecorder → 本地媒体处理/保存，没有固定品牌水印。片场发生变化时取消导出。
- `agent-widgets/whitebox-capture.mjs`：截图与录像取实际 Canvas；`window.tapnow.createWhiteboxCapture` 是生成内容调用的兼容 API，故保留。

以上为当前源码与导数验证，未在本子任务控制浏览器、下载或重新导入实际产物；不据此声称全部视觉与运行结果通过。模型生成的 HTML、用户导入内容或历史数据可能自行包含旧名称或外部资源，不能通过全局品牌替换改写它们。

## 可运行检查与人工验收

在项目根目录执行：

```bash
node --test tests/agent-picker-local-presentation.test.cjs
node --check src/features/agent-apps/picker-local-presentation.mjs
node --check src/features/agent-apps/qa/production-progress.mjs
git diff --check -- src/features/agent-apps/picker-local-presentation.mjs src/features/agent-apps/qa/production-progress.mjs src/features/agent-apps/qa/production-progress.html tests/agent-picker-local-presentation.test.cjs docs/AGENT-EMBEDDED-LOCAL-BRAND-20261005.md
```

两项定向语义测试通过：实际五语言字典的说明、其他字典标签不变；TemplateReferences 完整 JSON 与原 SDK 交接 script SHA 不变；完整源 SHA、未知版本/改字节拒绝；所有派生 script 可解析。小型 QA 图片更换只做脚本语法与实际 WebP 文件读取检查，没有为替换路径编写镜像测试。

生产接线之后：

1. `/src/features/agent-apps/qa/creative-family.html` 分别打开 Creative art/hardware 与 Website，核对底部说明、模板选取/搜索/确认与原合同；切换五种 locale，均不得出现“即将上线”。Motion 同样核对实际 locale 覆盖后的文字，不只检查静态 HTML。
2. `/src/features/agent-apps/qa/production-progress.html` 打开卡片，点击“提交本地测试完成状态”再重载；查看椅子 WebP、MP4 解码与来源记录。旧测试记录刷新本身不能偷偷修改字节。
3. `/src/features/agent-apps/qa/production-progress-brand.html` 检查 freenow 页脚 Logo 与英文/中文提示；用户标题 `TapNow 用户自定义项目` 原样保留。
4. 在 Network 中核对内层 iframe 无原站图片/Logo/API 请求。按实际 HTML、PNG、GLB、视频下载链验收：用户标题保留、无品牌水印误加、GLB easing 导出再导入行为保留。

剩余边界：上述生产接线/浏览器与下载再导入需新证据；此处没有全面验收选择器交互或商业模型质量。独立旧 QA shell 中的原 Logo 属于历史夹具，不代表正式页面品牌位置；本次只处理制作进度新提交的图片夹具。
