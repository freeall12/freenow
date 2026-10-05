# fal 视频分割合同核对 · 2026-10-05

**SAM2 的点击与提示帧输入可承接当前交互，但公开资料不足以可靠解码目标蒙层；本轮没有增加 fal 分割 adapter。** 只填写 fal Key 仍不能从新导入视频完成「识别目标 → 全时序 mask → 移除 / 替换」。现有自定义分割服务合同继续有效。

## 核对方式与候选

从 [fal sitemap](https://fal.ai/sitemap.xml) 确认真实 endpoint，再读取公开 `llms.txt`、导出 queue OpenAPI 与官方模型页面。没有 Key、上传、付费 inference 或浏览器操作；仅静态解析页面 JSON，没有执行远程 JavaScript。来源 URL、字节数、SHA256 和原生 schema 摘录保存在 [证据 JSON](research/video-segmentation-fal-contract-20261005.json)。

最匹配候选为 **`fal-ai/sam2/video`**：

- [模型及原生 schema](https://fal.ai/models/fal-ai/sam2/video)
- [输入说明](https://fal.ai/models/fal-ai/sam2/video/llms.txt)
- [导出 queue OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/sam2/video)

输入明确有 `video_url` 和 `prompts:[{x,y,label,frame_index}]`，x/y 是整数坐标，示例使用像素量级坐标；`label:1` 表示 foreground。本地输入是框选中心点和秒数 `time`，必须依据真实视频解码的帧 PTS 把秒数映射到对应帧，不允许固定 `frame_index:0` 或信任调用者提供的 fps。矩形只用来定位中心点，不能充当目标 mask。

初步比较也核对了 SAM3 与 SAM3.1：普通 `sam-3/video` 的 PointPromptBase 没有 `frame_index`，不适合当前任意时间点击；`sam-3/video-rle` 与 `sam-3-1/video-rle` 保留 frame_index。SAM3.1 的原生 schema 还声明每帧 `objects[][]` 和稳定 object_id，但其 RLE 编码缺口相同，因此本轮不扩大实现候选。

## 导出 schema 遗漏了实际输出 union

导出 queue OpenAPI / `llms.txt` 仅展示 `video:File`、可选 `boundingbox_frames_zip`。官方页面的 Next 数据中，`modelData.appData.metadata.openapi` 原生响应实际包含以下 union：

| SAM2 输出 | 公开字段 | 能确认的范围 |
| --- | --- | --- |
| SAM2VideoOutput | `video:File` | 分割视频文件存在；描述仅为 “The segmented video” |
| SAM2RLEOutput | `rle:string \| string[]` | RLE 可直接返回；未声明每个字符串与帧的对应关系 |
| SAM2RLEFileOutput | `rle:File` | RLE 可返回文件；未声明文件 JSON 结构或文本编码 |

这说明不能因为简化导出 schema 没有 rle 就断言服务不返回 RLE；也不能因为原生类型出现 RLE 就假定它等于本地 `rle-zero-based-row-major`。

## mask video 是否能避开未知 RLE

SAM2 原生输入字段完整列表为 `video_url`、`mask_url`、`prompts`、`box_prompts`、`apply_mask`、`boundingbox_zip`。**没有 `output_format`、`mask_only`、`output_type` 或 `return_rle`。**

`apply_mask` 默认 false，描述仅为 “Apply the mask on the video.”。公开合同没有明确 false 对应黑白 mask video，没有声明目标白 / 背景黑、alpha、类别颜色或阈值，也没有指明哪个 union 分支会返回。`boundingbox_frames_zip` 明确是边界框 overlay，不能代替逐像素目标蒙层。

因此，安全下载视频并用 FFmpeg 逐帧解码可以证明文件内容、宽高、PTS、帧数，但不能证明某个亮度或颜色代表目标。把 `apply_mask:false` 猜成白色目标视频、把彩色 overlay 按亮度阈值转 mask、把黑色来源像素误判为背景都会生成语义错误的 mask。本轮不实现这种转换。

实际 HTML 列出的 143 个 script src 共 9,407,868 字节均读取成功，静态查找未发现 RLE 解码或点击帧映射实现。这不是对全部动态 chunk 的覆盖，也不是模型测试；仅表示没有从所读官方客户端代码补齐编码证据。原生输出说明始终只有 “Run Length Encoding of the mask.”。

## 可实现与尚不能证明

| 能按已有合同实现 | 不能从当前公开证据证明 |
| --- | --- |
| 真视频上传，单个 foreground 点击及非零提示帧 | RLE 是零基还是一基，按行还是按列展平 |
| 实测源宽高、帧 PTS、CFR fps、总帧数和时长 | RLE 是 start/length，还是交替背景 / 前景 counts，或 COCO 压缩编码 |
| 下载安全、字节预算、取消和单次队列提交 | 分割视频是否为二值 mask、目标极性及像素阈值 |
| 按实测帧数拒绝截短、漏帧或尾部残缺返回 | 任意非零提示帧是否完整传播到前向与后向全时轴 |
| 检查结果尺寸、帧数、fps、时长和本地 RLE 越界 | 同样合法的数字游程是否对应正确空间位置和目标，而非错误编码 |

完整时轴不必仅靠供应商承诺：未来可逐帧核对返回长度与实测源帧数，缺失则拒绝，不能复制首帧、补尾帧或把提示帧之后的数组冒充完整来源。但这种拒绝策略不能解决 RLE 编码和 mask 像素语义未知的问题；错误的一基 / 列主序编码可能依然通过数值越界校验。

## 达到可接入所需的最小补充

需要供应商部署对应的明确输出合同或有来源的响应样例加编码实现，至少满足一个分支：

1. RLE：确认索引基数、展平顺序、游程形式、完整帧顺序及文件结构，再逐帧转换为本地零基行主序，并以真实源元数据验证全时轴。单帧字符串不能扩成多帧。
2. mask video：确认返回的是目标二值 mask 及极性，再真实解码每一帧，核对尺寸 / PTS / 帧数 / fps，与原来源完全匹配后编码为本地 RLE。

之后才可复用实际媒体 probe、安全上传和 fal queue 模块，实现独立 adapter、非零提示帧 / 移动目标 / 完整时序测试，以及有授权的真实供应商验收。模拟数据只能验证本地编码与流程，不能补足未知供应商语义。

本轮新增本说明和证据 JSON，未改 `server/video-segmentation.cjs`、路由、前端或配置。证据 JSON 已重新解析并核对输入字段 / 输出 union；未运行模型或全套测试。配置就绪、账号资格、提示帧双向传播及真实目标质量仍未验。
