# 独立 OpenAI 全景局部编辑

本模块把片场当前相机前的球面框选转成透视 crop 和 alpha 蒙版，调用一次 OpenAI `images.edit`，在本机把结果投回 2048×1024 等距柱状全景。它是显式的独立替代实现，不能宣称原站模型、原站三图编辑效果或完整全景重绘。用户未框选时明确拒绝；不会自动转成整图图生图。

## 依据

2026-10-05 读取官方安装包 `/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js`：`H8` 上传 `patch-original`、`patch-masked`、`patch-region-guide` 三份图；`W8` 用 `patchCamera/cropRect` 投影框选，`destination-out` 生成透明区域。局部提示词区分原图、透明图和只读区域指引，要求只修改透明区域，并解释全景左右边缘相邻。官方同时存在独立的无选区整图全景编辑路径。因此，本实现的单 crop + mask 路径有依据，但不冒称完整原站三图合同或官方供应商身份。

公开 OpenAI [Images Edit 参考](https://developers.openai.com/api/reference/resources/images/methods/edit)与[图片生成指南](https://developers.openai.com/api/docs/guides/image-generation)均在本次通过无凭据 GET 读取。指南明确展示 `client.images.edit`、`response.data[0].b64_json`、alpha 蒙版和同尺寸/格式要求。安装的官方 `openai@7.20.0` 的 `resources/images.d.ts` 第 433 行起明确 `gpt-image-2`、PNG 图像上传、同尺寸 mask、alpha=0 编辑区域、PNG base64 结果及标准 1024×1024 输出。指南现在主要推荐更晚的 2.5 模型；本模块仅使用已有独立蒙版适配器已审阅的 GPT Image 2 合同。mask 采用更严格的 <4 MiB 本地/SDK预算，不把当前指南 <50MB 解释为放宽本实现预算。

## 精确显式配置

协议：`openai-panorama-edit-native`。操作仅 `panorama.edit`，配置为 kind-only route。未配置或未知别名保持 `configuration_required`，不回退到其他供应商。

```json
{
  "panorama.edit": {
    "kind": "panorama.edit",
    "model": "gpt-image-2",
    "semantics": "perspective-mask-reproject",
    "quality": "high",
    "cropSize": "1024x1024"
  }
}
```

五项均必填，不能追加参数。模型另允许 `gpt-image-2-2026-04-21`，质量允许 low/medium/high/auto。请求不能覆盖服务端 cropSize/quality/model。接线工厂 `createOpenAIPanoramaEditProvider`，媒体准备 `preparePanoramaEditMedia`，配置守卫 `assertPanoramaEditConfiguration`；共享 router、服务器和正式片场接线由主任务负责。

## 原片场合同与限制

直接接纳现有 `makePanoramaRequest`，不猜字段：

```js
{
  kind: 'panorama.edit', nodeId, label: '全景图编辑', prompt,
  inputs: [{type: 'image', image: 'data:image/png;base64,...', projection: 'equirectangular'}],
  parameters: {
    binding: {nodeId, setupId, sessionId, revision},
    camera: {position: [x,y,z], quaternion: [x,y,z,w], fov, aspect},
    regions: [{id, color, directions: [[x,y,z], [x,y,z], [x,y,z], [x,y,z]]}],
    output: {projection: 'equirectangular', width: 2048, height: 1024, composite: true},
    coordinates: {
      directions: 'world unit vectors; Y up; front -Z',
      uv: 'u=atan2(x,-z)/(2*pi)+0.5; v=asin(y)/pi+0.5; v grows upward'
    }
  }
}
```

来源必须为真实完整、非交错 8-bit RGB/RGBA PNG，<=32 MiB，实际 2048×1024，全部不透明。浏览器真实解码其他静态 PNG/JPEG/WebP，再按原尺寸转换；不缩小素材，不承诺原压缩编码或 ICC 色彩原样。后端先按已验证 envelope 的实际 IHDR 宽高拒绝超预算分配，再检查实际 PNG CRC、chunk 顺序、完整 deflate 和全部像素；拒绝 APNG、截断、额外尾部和未审阅的 `zTXt/iTXt/iCCP` 压缩 metadata。请求、原字节、全部解码像素、供应商 JSON 和结果均检查凭据回显；不是 OCR 或任意隐写识别。

只接纳 1–32 个有序、闭合、凸四角单位方向，且所有角点位于当前相机可见视口。相机 quaternion 必须归一化，fov 15–110 度、aspect (0,10]。视口之外、退化、自交、背面、未知投影、矛盾节点绑定和额外参数在派发前拒绝。对于极小区域，在 crop 与全景各检查一个最近中心样本是否真实落入球面选区；不能证明时要求扩大框选，即使某些其他样本可能落入区域，也不花费模型调用。

使用各区域透视边界的联合范围，扩展 25% 后形成平方 crop，保留上下文。crop 和 mask 均为1024×1024；mask 区域内 alpha 精确为0，区域外255。原图片不透明，不让来源 alpha 隐式变成用户选区。空 prompt 与有效框选时使用官方已有的“移除区域内容并自然补全”意图，非空用户 prompt 原样附入。不会生成带数字/颜色的第三参考图，涉及 `[1]` 等标记的复杂原站三图指引不保证等效。

回投遵循原片场球面坐标和像素中心判定，正确处理全景左右 seam 与北/南方向。crop 和回投均用最近像素采样，不做 feather、颜色修补或隐式扩区。**所有球面选区外 RGBA 像素逐字节保留**；选区内须有真实不透明结果像素，未知尺寸或透明缺口不发布。区域边界/材质可出现接缝，蒙版遵循和视觉连续性须真实供应商验收。PNG文件经过重编码，像素保留不等于整个 PNG 字节保留。

## 状态、保存与恢复

供应商同步 API，没有本实现可远端恢复的任务 ID，`remoteRecovery/remoteCancellation:false`；没有 poll/cancel。SDK 和单次请求 `maxRetries:0`。未知结果、超时、5xx、408/409、格式不符或凭据回显返回 unknown，绝不自动重发。真实 SDK 明确的其他4xx拒绝才变成 failed/provider_rejected。取消仅停止本机等待与接收，不保证远端计算或计费停止。

`prepare` 只校验来源、参数和可证明真实像素，不反复编码 crop；`submit` 生成 crop 一次并只发一条编辑 POST。模块不实现全局结果缓存。已由 generation durable 保存的成功结果可由正式应用事务重试保存，不重新请求模型；源会话/选区变化后不能绕过 guard 应用。片场保存屏障、刷新和结果去重由共享前端事务负责，不能仅凭此后端测试宣称浏览器恢复成功。

## 专项验证

```bash
node --test tests/generation-panorama-edit-openai.test.cjs
node --check server/generation-panorama-edit-openai.cjs
node --check server/generation-panorama-edit-geometry.cjs
node --check src/features/panorama-edit/native-profile.mjs
node --check src/features/panorama-edit/media.mjs
```

2026-10-05：7/7 通过，无跳过。实际 `makePanoramaRequest` 与请求夹具完整相等；真实安装 SDK multipart 的单 POST、完整 crop/mask PNG和回填2:1；普通及跨左右 seam 球面选区的逐像素区域外保留/区域内回投；硬alpha边界、透明缺口拒绝；全局/视口外/自交/矛盾绑定零派发；压缩metadata拒绝、source IDAT解码像素与输出 UTF16LE像素凭据回显；坏结果/超时保持unknown且不重试；前端素材物化保留原image/projection合同、拒绝原站来源、错误实际尺寸和不足能力。

一次本地合成全白2048×1024PNG（10,669字节）样本：prepare 587ms，submit（内存 mock，含1024crop+全景回投及PNG编码）1494ms，POST=1。并行负载会影响时长；这是一次CPU/codec观察，不代表供应商延迟、浏览器帧率或普遍性能提升。`three` CJS加载会产生官方依赖弃用警告，当前版本运行正常，没有安装新依赖。

独立交审发现解码前像素预算需早拒绝，已修正来源/结果 IHDR 精确尺寸门槛；修改后非法来源与 unknown 响应两项 focused 回归 2/2，通过语法及差异检查。交审复核无剩余阻断项。

未读真实 `.env`/Key、未调用真实模型、未上传用户素材。账号可用性、额度、组织资格、真实模型蒙版遵循、物体一致性、材质和接缝效果尚未验证。正式浏览器UI与持久保存验收由主任务继续记录。
