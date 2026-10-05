# SAM2 二值 PNG 与完整 RLE · 2026-10-05 / 1005n

新增纯本地 codec / merge：[实现](../server/video-segmentation-masks.cjs)、[11 项专项](../tests/video-segmentation-masks.test.cjs)。它将原尺寸、白255目标 / 黑0背景的无损 PNG 转为现有 `rle-zero-based-row-major`，按真实片段 `sourceIndices` 合并完整来源时轴。未调用供应商、上传媒体、读取 Key / 私人素材、添加依赖或改动已有 PNG decoder。

供应商依据与尚未验收的边界见 [Replicate readiness](VIDEO-SEGMENTATION-REPLICATE-READINESS-20261005.md)：公开源码声明 PIL 灰度二值 PNG，但本轮 fixture 全部本地合成，**没有真实成功 binary PNG 响应**。部署版本与 Git snapshot 的精确映射、实际模型质量、逆序跟踪以及双路提示帧严格一致性的通过率仍未验证。

## 接口

```js
const {decodeSegmentationPng,mergeSegmentationMasks} =
  require('../server/video-segmentation-masks.cjs');

const frame = decodeSegmentationPng(pngBytes, {
  width: actualWidth,
  height: actualHeight,
  // 可选，只允许收紧默认硬上限。
  maxBytes: 32 * 1024 * 1024,
  maxPixels: 16 * 1024 * 1024
});
// {width,height,rle,pixelSha256,foregroundPixels}

const mask = mergeSegmentationMasks({
  source: {width: actualWidth,height: actualHeight,
    fps: actualFps,numFrames: actualFrameCount,duration: actualDuration},
  prompt: {frameIndex: k},
  branches: [{
    direction: 'forward', // 或 reverse；中间提示帧必须两路齐备。
    numFrames: actualFrameCount-k,
    sourceIndices: [k,k+1 /* … 到 N-1 */],
    frames: [frame /* … 每张 PNG 的完整 decode 记录 */]
  }],
  maxRleBytes: 64 * 1024 * 1024,
  maxTotalPixels: 512 * 1024 * 1024
});
// {encoding:'rle-zero-based-row-major',width,height,fps,frames:string[]}
```

上面 branch 示例仅适用于 k=0；中间 k 必须再提供 `reverse`，最后帧仅提供 `reverse`。一个来源帧时使用 `forward`。不接受为边界另外增加只有提示帧的冗余分支。

`pixelSha256` 是解码后单通道、逐像素0/255字节的 SHA256；灰度、RGB 和 RGBA 保存同样二值像素时摘要相同。它不依赖 PNG 压缩字节或通道数。`foregroundPixels` 是白255像素数，单帧允许为空，以保留遮挡 / 离画等结果；最终全部帧为空时拒绝。合并会重建每帧0/255像素，核对摘要及目标像素数，不能仅凭调用方声称已验证就信任 RLE。

所有拒绝均抛出固定、无供应商内容的本地错误：`code='segmentation_invalid_result'`、`status=502`。模块没有网络、磁盘、持久化或日志副作用，PNG归档及取消 / 恢复属于 native adapter 的职责。

## 格式与预算

- 校验签名、所有 chunk CRC、唯一首位 IHDR、完整 IEND、准确解压长度及 zlib 压缩流消费长度；拒绝截断、尾随字节、额外压缩流和不支持的 filter。
- 仅接受 IHDR / 非空 IDAT / IEND。拒绝全部 ancillary chunk，包括文本、压缩文本、ICC、调色板、透明信息和动画；也拒绝未知 critical chunk。即使标准可选 `gAMA` 也拒绝，这是针对当前供应商最小输出合同的保守边界。
- 仅支持非交错 8-bit 灰度、RGB、RGBA；RGB三个通道必须相同，RGBA额外要求 alpha=255。每个目标像素必须精确0或255，彩色 overlay、中间灰度与任何透明像素均失败，绝不阈值化。
- 宽高必须与实测来源相同、各不超过65535、单张最多16,777,216像素。单 PNG 最多32MiB；解压上限按 `(width*channels+1)*height` 精确设置，最大不超过64MiB+65535字节（RGBA与每行滤波字节）。
- 全分支最多512Mi像素，含重复提示帧。RGB/RGBA解码raw总量因此最多约2GiB，逐张处理；合并只为当前帧分配单通道像素，无整序列像素缓存。RLE总文本最多64MiB，也包含两个分支的提示帧；两个可选预算只能收紧。
- 帧数最多54000、fps为实测值且不超过240；时长按现有 core 的容差验证。CFR、PTS / 来源时长的更严格实测校验由准备模块执行，本模块不探测媒体。

native adapter 应在下载首帧前依据已验证的宽高与 `N` / `N+1` 帧数检查总像素预算，并累计整任务实际下载字节。单张 `maxBytes` 不能替代整任务下载预算。模块在合并前检查全部像素预算并逐帧累加 RLE；RLE编码按有界文字片段拼接，重新验证采用逐游程读取，避免棋盘状 mask 产生数百万个保留 token 对象。

## 时间映射

每个 branch 的 `numFrames`、`sourceIndices.length` 与 `frames.length` 必须准确匹配；前向索引必须逐个等于 `k+j`，倒序索引逐个等于 `k-j`。方向重复、多余分支、重复 / 不连续 / 缺少 / 额外索引或 PNG 帧全部拒绝。数组方向顺序不影响结果。

中间 k 两路的第0帧二值像素摘要必须完全相同，且摘要先经本地 RLE像素重建核对；不一致时拒绝，不取并集、交集或忽略差异。原帧 i<k 取 `reverse[k-i]`，i≥k 取 `forward[i-k]`，提示帧保留前向一次。末帧一路时按倒序索引完整复原。输出 exactly N 条原顺序 RLE 与原 fps，没有首帧复制、尾帧补齐或矩形替代。

RLE使用零基 `y*width+x` 索引及 `start length` 成对十进制文字，跨行相邻目标继续同一 run。输出规范形式无前导零、前后空格、重叠或可合并的相邻run；重新验证也严格拒绝这些非规范表达。

## 已验证

```bash
node --test tests/video-segmentation-masks.test.cjs
node --check server/video-segmentation-masks.cjs
node --check tests/video-segmentation-masks.test.cjs
git diff --check
```

专项 **11/11通过，无跳过**。fixture 用真实 `deflateSync` 和合法 PNG CRC 编码，覆盖三种通道布局、所有五种 filter、跨行 row-major RLE、通道无关像素 SHA、非空 / 空帧、CRC / chunk / 格式 / 解压边界、透明及非二值拒绝；N=1/2/5/11每个 k 的首中末帧映射、两路提示帧冲突、缺重额外分支 / index / frame、伪造摘要与计数、全空失败及两类总预算。碎片化棋盘像素还跨越编码文字片段验证完整 RLE一致性。真实 core `decodeMask` 与 `validateMask` 已参与专项，确认字符串帧数组兼容现有实现。

这证明本地格式和映射合同；不证明远程服务当下可用、供应商输出顺序 / 数量或 SAM2跟踪质量。真实有授权供应商验收须继续覆盖移动目标、遮挡、倒序、严格提示帧一致性与远程一小时输出失效。
