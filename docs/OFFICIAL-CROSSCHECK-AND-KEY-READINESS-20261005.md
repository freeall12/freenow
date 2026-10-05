# 官方功能交叉核验与 Key 接入状态

更新：2026-10-05，含重新打光、全景、视频蒙层编辑及此前交叉核验。**不代表全站一比一完成，也不代表每个菜单填入任意 Key 即可使用**。真实供应商生成仍未验；测试使用本机合同服务及真实媒体字节。

## 参考与判定方式

| 来源 | 本次核对内容 | 使用边界 |
| --- | --- | --- |
| [官方图片说明](https://docs.tapnow.media/zh/docs/canvas/generate-and-edit-images) | 参考图、比例/规格/数量、九宫格切分、蒙版编辑、图片 Toolbar | 新文档出现 Images 2.5；历史安装包/Web 的型号与当前文档可能不同，不能只改展示名就宣称已接通 |
| [官方视频说明](https://docs.tapnow.media/zh/docs/canvas/generate-and-edit-video) | 首尾帧/参考、样片转正式片、深度、H3、编辑/延长/重拍和新结果连接 | 页面操作描述不是供应商 API 合同；模型资格与输出质量要单独验证 |
| [官方音频说明](https://docs.tapnow.media/zh/docs/canvas/generate-and-edit-audio) | TTS/音乐/音效、参考限制、输出格式、字幕文本节点 | 品牌名不表示协议等价；Seed/Mureka/Sonilo 的 Key 不能当作 OpenAI/ElevenLabs Key |
| [官方 Agent 生成模式](https://docs.tapnow.media/zh/docs/agent/choose-a-generation-mode) | 自动执行与手动确认卡、模型/参数/参考编辑 | 生成始终走本机适配器；原站积分/计费不接入 |
| 本机 TapNow 安装包 0.4.81 与已抓取官方 Web bundle | 多角度四参数、滑杆范围、旋转取反、私有转换请求 | 只读静态资源用于核对；运行不请求原站；[包路径/哈希与接口证据](FAL-MULTI-ANGLE-NATIVE-20261005.md) |
| [阿真 Irene 实际创作流程](https://news.qq.com/rain/a/20260205A03A7J00)（2026-02-05） | 角色多参考 → 九宫格 → 切分/角度/细节修正 → 首尾帧视频 → 背景音乐 | 作为使用反馈补足跨功能链路，不作为设计或供应商字段的权威；不复刻推广/分享/社区页面 |
| 供应商官方 API 与公开 SDK/社区实现 | Responses 续轮、Ark edit/extend、图片响应、fal 队列 | 具体来源及固定 SDK/社区版本见三份专项报告，不能用搜索摘要替代接口证据 |

实际复刻以官方页面/安装包为设计证据，localhost 仅用于验收。社区反馈用于检查创作链条中参考绑定、节点来源、重试和结果保留的习惯，不推断不存在的 API。

## 本批实际变化

1. **Agent 多轮调用。** 用已锁定 OpenAI SDK 的 `toResponseInputItems` 规范化请求输入，移除仅用于输出的 provenance/parsed 字段；保留工具 `call_id`、推理密文、message phase 和原始检查点。[Agent 核对与限制](AGENT-PROVIDER-CROSSCHECK-20261005.md)
2. **Ark 视频。** 显式 edit/extend 校验视频来源与 adaptive 画幅；edit 额外校验 -1 时长和 4–30 秒来源；没有实际裁片的 clip/trim/sourceClip 在发送前拒绝。[视频核对](VIDEO-PROVIDER-CROSSCHECK-20261005.md)
3. **OpenAI 图片响应。** 截断 PNG、缺少 IDAT/IEND、非规范 Base64 保持 unknown，不记录成功、不重复提交。[图片/音频核对](IMAGE-AUDIO-PROVIDER-CROSSCHECK-20261005.md)
4. **多角度原生替代。** 新接 fal 官方 `qwen-image-edit-2511-multiple-angles`；仅通过显式模型映射启用。原站私有四参数转换未公开，广角和倾斜低于 -30° 拒绝；水平正方向、缩放与实际视觉效果仍需真实 Key 验收。[配置与转换](FAL-MULTI-ANGLE-NATIVE-20261005.md)
5. **配置与交互。** “连接生成 API”现在列出 24 类操作，缺失路由也显示。原生配置就绪标注“待实测”，通用网关标注“功能待核验”；不能将 URL/Key 已填写等同功能已实现。修复迟到配置响应污染已保存状态和配置视图的竞态；折叠清单与内层滚动避免小窗口遮挡保存按钮。
6. **多角度来源保护。** 配置/不支持参数检查先于创建占位；面板关闭后的迟到读取不会造节点。源对象、项目和目标对象都须保持身份；失败清理只能删除本次目标。新节点按完整包围盒平滑取景，避免把左上角放在视口中心后裁掉半幅。
7. **本地品牌。** 画布、片场、全景、Agent HTML 预览和模型展示名改为 freenow；新 Logo 直接复用成熟 Tabler F 标识的本地 SVG，不自绘图标。[品牌范围](FREENOW-RUNTIME-BRAND-LABELS-20261005.md) / [标识来源](../assets/branding/README.md)。来源作者、许可、旧别名和用户正文保留。
8. **ElevenLabs Music。** 已按官方OpenAPI/SDK接公开Compose API，支持普通/纯音乐及有明确3–120秒时长的单节自定义歌词；节点按实际路由进行参数预检并保留隐藏草稿。接口不发送隐藏字段，不自动替换已标deprecated但仍合法的`music_v1`。[合同、配置与CUA](elevenlabs-music-native.md)
9. **音频结果与本地资源。** 四个音频适配器补齐UTF-16标签中的凭据回显拒绝；同源合法资产引用规范化，多角度QA先真实归档，刷新仍解码且没有新增修复提示。[音频保护](AUDIO-CREDENTIAL-BYTES-20261005.md) / [本地引用](LOCAL-RESOURCE-SAME-ORIGIN-20261005.md)
10. **Mureka与Seed Audio。** 对照各自官方合同完成原生适配、共享路由、节点参数预检、音频归档与字幕落图；不再把这三个别名仅列为任务网关占位。Mureka仅精确8/O2，Seed为多模态音频1.0而非旧TTS；子集与真实账号待验条件见[Mureka](MUREKA-NATIVE-20261005.md)、[Seed](SEED-AUDIO-NATIVE-20261005.md)。
11. **公共工作流与Agent组图。** 10个真实工作流、8种官方分类与引用媒体全部本地化；简单/复杂图应用、精确坐标、撤销、刷新和视频播放已浏览器核对。组图原HTML的质量选择、默认值、编辑/确认/回焦修复并核验。[本批范围](LOCAL-WORKFLOW-AND-NATIVE-AUDIO-20261005.md)。10个工作流不等于92份创意HTML模板。

## 能否仅填 Key 使用

本次新增：`fal-video-audio-native` 以操作者显式映射提供 ThinkSound 视频拟音；`ark-video-extend-reference`按安装包和实际官方Web菜单接延长镜头参考生成。两者的供应商限制、Agent时长、菜单操作与本机媒体证据见[本批记录](LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)。

| 状态 | 能力 | 必须同时满足 |
| --- | --- | --- |
| 已有原生适配，本机合同已验证，真实 Key 待验 | OpenAI 文本/图片/参考图/视觉分析/语音，GPT Image 2 蒙版编辑 | 正确供应商 Key、实际型号访问权、明确公开别名及尺寸/质量/参考能力映射；不是所有原站品牌的替身 |
| 同上 | Ark 视频、MiniMax H3 | 正确 Key、实际可用型号及 profile、模式/时长/分辨率/参考符合供应商合同 |
| 同上 | fal 抠图、Topaz 图片增强、FLUX/Proteus 视频增强 | 对应 endpoint 的显式模型映射；不支持的倍率/模式拒绝 |
| 新增受限原生替代 | 多角度 | `image.multiAngle` 明确映射到 Qwen 2511；关闭广角，倾斜至少 -30°；效果不承诺与原站模型同态 |
| 已有原生适配，本机合同已验证，真实 Key 待验 | ElevenLabs V3 TTS、SFX、Music，MiniMax Music 2.6 | 正确音色/模型、格式参数与账号 API 资格；Music自定义歌词须明确3–120秒；不能代替未实现的参考/字幕/cover功能 |
| 同上 | Mureka 8/O2 歌曲，Seed Audio 1.0 多模态音频 | 各自供应商Key和服务资格；Mureka两种歌词模式的字数子集，Seed参考数量/30秒/格式和采样率合同；不支持项提交前拒绝 |
| 新增显式原生替代，本机合同已验证 | 单视频拟音：ThinkSound | 独立fal Key、明确sonilo-sfx映射、一个完整MP4；跟随真实视频时长。供应商最大时长未公开，音乐/分段/循环未覆盖 |
| 参考生成适配已接线，本地媒体传输仍有限制 | Toolbar `video.extend` | 正确Ark Key/真实型号/profile、4–30秒、明确prompt_simulation及公网HTTPS视频；本地视频需额外发布通道，方向/连续性效果待真实模型验收 |
| 有原生生成但部分格式仍阻塞 | Tripo / Marble 3D | 正确 Key/模型/输入；GLB 可本地渲染，SPZ 片场渲染尚未完成 |
| 显式参数编辑已接入，实际模型效果待验 | 图片重新打光 | OpenAI Key、GPT Image 2访问权、明确parameter-prompt-edit映射；全部原控件参数编译，不保证物理精确照明或固定输出画幅 |
| 显式原生替代已接入 | 单图360全景、已保存时序蒙层的视频移除/替换 | fal Key与各自映射；全景要求实际PNG，视频编辑要求完整蒙层/FFmpeg；首次目标识别仍需独立分割服务 |
| 参考编辑已接入，本地媒体传输有限制 | 视频重拍 | Ark Key、实验性prompt_simulation映射与独立公网HTTPS视频；本地上传和真实相机效果待验 |
| 已有原生适配，本机合同已验证，真实 Key 待验 | Magnific Precision完整图片放大 | Magnific独立Key、明确 `image.upscale:magnific` 映射、四参数与原尺寸媒体；原UUID查询/结果归档已接，账号与效果待验。[合同](MAGNIFIC-NATIVE-20261005.md) |
| 独立原生局部编辑已接入，实际模型效果待验 | 片场全景区域编辑 | OpenAI Key、GPT Image 2资格、明确 `perspective-mask-reproject` 映射；2048×1024不透明PNG、1–32个当前可见凸四角选区；硬边回投不等于原站三图或整图编辑。[限制](OPENAI-PANORAMA-EDIT-NATIVE-20261005.md) |
| 原生供应商与Agent深度流程已接入，节点入口未接 | 视频深度 | fal Key、明确 `depth-anything-video` 映射、FFmpeg/FFprobe；32 MiB完整MP4、宽<=1920/高<=1080、恒定5–30 FPS、最多2400帧，无声音灰度且保持源尺寸时长。真实深度效果待验。[后端](VIDEO-DEPTH-NATIVE-20261005.md) / [入口边界](VIDEO-DEPTH-FRONTEND-QA-20261005.md) |
| 专用任务网关已接，品牌原生供应商仍待补 | 皮肤编辑 | 实际实现三档合同的 `skin-tasks-v1` 网关及其Key；单填Enhancor Key不能直接启用，公网来源/webhook与三档换算仍需独立实现验收。[网关合同](SKIN-EDITOR-PROVIDER-20261005.md) |
| 前端与任务合同已有，专用供应商仍待补 | Sonilo音乐及部分音频场景 | 必须补专用供应商适配或提供已经实现这些操作的任务网关；单独填写品牌 Key 不够 |
| 仍开放 | 92 份精确创意模板、全部页面细节/资源/交互及最终性能验收 | 需要继续官方逐项证据和真实运行验证，不能由模型 Key 解锁 |

`video.generate` 中供应商的 edit/extend 子模式，和 Toolbar 的 `video.extend`、`video.replace`、`video.erase`、`video.reshoot` 是不同任务合同。工具栏延长、重拍与蒙层移除/替换现各有独立接线，具体参数与媒体限制仍以对应合同为准，不能由供应商支持普通视频生成自动推定覆盖。

打光专项已核对 IC-Light v2、Image Apps v2、BRIA Fibo 和 Light-X 的公开 schema，均不能完整承接现有26光位、亮度、Kelvin和独立轮廓光合同。现已新增显式 `openai-relight-native` 参数提示词编辑，完整保留26光位及其他控件；这是独立实现，不宣称复现私有模型。[适配器与配置](OPENAI-RELIGHT-NATIVE.md)。[精确来源与差异](IMAGE-RELIGHT-NATIVE-20261005.md)

## 验证证据

- 重新打光：对照安装包与官方Web控件，独立适配12项、网关持久集成4项及前端/Agent专项通过；正式面板、五参数确认、一次SDK POST、保存失败原结果重试、配置/来源迟到零提交和实际PNG刷新已实操。另修复配置快照及本地图片启动竞态。[证据、截图与边界](LOCAL-RELIGHT-AGENT-20261005.md)
- Agent：53项定向通过；后续复核修正3项HTTP fixture预期，HTTP两文件7/7、相邻合同56/56。生产代码不变：SIGKILL后的媒体锁仍需操作人员恢复，短SSE尾段仍受凭据保护，不代表新增无干预强杀重启能力。[复核记录](AGENT-HTTP-RECOVERY-20261005.md)
- 视频：72项；图片/音频：114项；新多角度后端12项加原 fal/queue/integration 23项。按改动选择检查，没有运行全库回归。
- 配置/多角度前端：15项配置检查、5项角度模型检查、5项媒体准备检查；关闭/配置竞态和不支持设置均有回归。
- Computer Use：正式配置函数的 routed/native/gateway/offline 分支、清单展开/滚动、Escape关闭回焦；593×783窗口保存按钮可见。多角度广角与 -45° 两条路径零任务提交且没有占位；合法默认值提交一次，真实本地 PNG 解码为180×320并连接来源，源坐标100.25/80.5保持。完成取景后结果边界x207.82–385.18、y234–549位于593×783视口内；刷新后原图/结果仍解码。浏览器夹具的图片是合同媒体，**不是模型实际生成效果**。
- 多角度QA先前11项提示定位为两个`/src/` PNG在当前/历史字段中的重复引用。新session使用真实LocalAssets归档后，刷新两图320×180/180×320解码、源坐标100.25/80.5保持，无待本地化提示；旧session未改。没有将`/src/`加入生产白名单。[资源根因与验证](LOCAL-RESOURCE-SAME-ORIGIN-20261005.md)
- Music：48项接口/音频前端定向检查；独立音频字节保护56项。正式菜单验证自动/121秒自定义禁用、47秒可提交，真实0.2秒MP3播放并刷新回读；纯音乐wire无歌词，缺Key/路由不增任务，两次有效生成各一次POST。47秒是请求合同，不是实际生成音乐长度或质量。
- Key 从未进入浏览器持久存储或文档；本批公开索引扫描在提交前执行。运行资源继续仅本地，新后端只请求操作者配置的独立供应商。

复现：运行 `node server/server.cjs`，打开 `http://localhost:4173/src/features/generation-config/qa/main.html?session=my-check&profile=routed`。可选 `native`、`gateway`、`offline`、`angle`；页面使用独立 IndexedDB 偏好/画布/媒体，不修改用户项目，也不保存真实服务配置。QA 单独替换公开 metadata；`angle` 使用本机合同任务及仓库 PNG，其他请求不改变正式服务。

![本地配置诊断](screenshots/generation-readiness-routed-20261005.png)
