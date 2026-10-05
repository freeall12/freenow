# 视频深度前端与隔离验收（2026-10-05）

`video.depth` 保持既有 `local-depth-v1` 请求合同；新增原生供应商为 `fal-video-depth-native`。公开别名 `depth-anything-video` 的真实模型由 `capabilities.videoDepth[alias].model` 证明；通用 routed models 表仅提供 kind/label，不能用于检查供应商模型名。

## 行为边界

- `depthRequestState/assertDepthConfiguration` 在媒体读取前检查路由、配置、明确模型与原尺寸/时长/灰度无声音能力。只支持完整 MP4、偶数宽高、最大 1920×1080、恒定 5–30 fps、最多 2400 帧和 32 MiB；实际帧时序、像素比例及完整解码由本机后端验证。
- `prepareDepthMedia` 实测来源尺寸/时长，传输完整实际 MP4 字节；保持 id、顺序和来源。取消、来源变化、原站资源、额外设置、尺寸时长不一致或预算超限均拒绝，未压缩、改速或截短。
- `prepareDepthTaskRequest` 拒绝未知顶层/参数/来源字段、矛盾型号、额外参考、非单结果和额外提示词；已校验的请求按原样返回，保留等价公开别名与宿主应用回执，避免重建请求擦除用户意图。
- Agent 深度 host 必须取得宿主配置后才能准备来源或转换；新轮次、来源身份或媒体签名变化在准备、派发和输出解码后均失去授权。实际查看帧送达的既有回执仍是生成前置条件。
- 结果保持既有独立浏览器解码检查；provider 尺寸/时长不充当证据。保存失败保留已创建的节点列表，重试只执行原任务结果应用/持久化，不重新生成、不创建第二组节点。
- 本批未接入官方同位节点生成选项入口；不声称 toolbar 或节点菜单已支持深度。隔离页面上的按钮是 QA 控制，不是产品入口。

## 验证入口

```sh
node --test src/features/video-depth/qa/frontend.test.cjs tests/depth-agent.test.cjs tests/agent-depth-card.test.cjs
node qa/depth-video-workflow-check.mjs
node qa/depth-output-media-check.mjs
node src/features/video-depth/qa/native-server.cjs 0
```

打开服务输出地址（`/src/features/video-depth/qa/main.html?mode=pipeline&session=depth-native-1005-pipeline`）。真实生产 App、`createDepthAgentHost`、媒体抽样/查看回执、GenerationAPI、TaskService、CanvasStore 和 LocalAssets；indexedDB/localStorage 全部使用该 session 专属前缀。页面/CSP 禁止外联，pipeline 仅对同源 `/api/generation/*` 直通专用安全测试服务。

测试服务使用真实生产 gateway、FFmpeg 全帧校验及本机素材归档；仅 fal 队列/下载边界返回本地固定灰度 MP4。来源 64×48、2 秒、20 fps、40 帧；QA 初始来源使用该公开文件的真实 data:MP4 字节。先点「恢复并真实保存来源」可导入真实 LocalAssets 的 asset: 引用，避免 /src 测试路径落入生产迁移的当前/撤销历史诊断。生产迁移规则未修改，不伪造媒体存在性。输出是来源经过 FFmpeg `hue=s=0` 的合同夹具，**不是模型深度，不能证明模型效果**。浏览器真实查看回执在 QA 控制中显式送达；不宣称跑了真实模型 Responses 会话。

1. 「准备实际视频参考」读取真实帧并显示模型限制；「确认已查看并转换」提交、实际解码、创建连线节点和保存。
2. 「查询后端归档审计」检查 supplierPosts 的增量与实际 MP4 bytes。返回视频应为本机 `/api/generation/media/<uuid>`；查看与播放实际视频，刷新同 session 保留节点。
3. 新 session 先点「模拟下一次保存失败」再准备/转换；原任务 succeeded + applicationError，已创建一个节点。「重试原任务应用」后清除错误、posts 不增加、节点不重复。
4. 「新轮次」清空查看回执；未重新准备就转换应拒绝。来源变更期间的迟到结果不得回填。
5. 非 pipeline 页面 `mode=unconfigured` 与 `mode=native` 提供缺配置/完整原生配置拒绝路径；POST 固定 403，不模拟成品。

本次 frontend 8项与既有 Agent/card 13项共 21/21 通过，新增真实初始字节/刷新迁移专项 1/1 通过，原 depth request/output QA 均通过；包含 routed profile、严格别名、迟到配置、输出新轮次守卫和保存重试回归。真实浏览器操作与刷新结果由 root 单独记录，未把 Node 测试作为浏览器证据。
