# 新视频首次识别：Replicate SAM2 接入评估 · 2026-10-05 / 1005m

**推荐下批实现一个固定版本的 Replicate SAM2 分割 adapter：从真实提示帧物化前向、倒序两段，各以 frame0 点击提示，接收二值 PNG 序列并拼回原来源时轴。** 公开供应商页面和其链接的部署源码提供了明确像素语义，可避开 fal RLE 编码未知的缺口。它仍是待实现、待真实供应商验收的候选；本批只读研究，没有新增 adapter，也没有改变现有分割配置。

## 新证据

[Replicate `meta/sam-2-video`](https://replicate.com/meta/sam-2-video) 当前公开版本为 `33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d`。页面直接链接 [部署仓库 video 分支](https://github.com/zsxkib/segment-anything-2/tree/video)，本次固定读取 commit `0850d194e6de09803e93694e72ce3004bdfd1429`。它是供应商模型页面，不等于 Replicate 的 always-on 官方模型产品；页面未标官方模型，当前展示 L40S / `$0.000975 per second`，价格可能变化，不能承诺固定单次价格。

这是新增证据，没有重读上批 fal 的 143 个 chunk。原始来源 hash、当前 schema、公开样例摘要保存在 [证据 JSON](research/video-segmentation-replicate-contract-20261005.json)。源码可追溯到供应商页面链接，但页面没有部署 digest 到 Git commit 的精确映射：版本 created_at 为 2024-08-14 12:25:20 UTC，链接源码最新提交为 12:27:49 UTC。因此不能宣称该 Git snapshot 与线上容器逐字节一致。

| 合同项 | 新证据与边界 |
| --- | --- |
| 实际点 / 帧 | `click_coordinates:"[x,y]"`、`click_labels:"1"`、`click_frames:"0"`、`click_object_ids:"target"`；parse_inputs 保留整数像素坐标和标签，送入 add_new_points |
| 二值极性 | [predict.py](https://github.com/zsxkib/segment-anything-2/blob/0850d194e6de09803e93694e72ce3004bdfd1429/predict.py) process_frame 对 logits > 0 的目标取并集，再乘255转uint8；目标白255、背景黑0 |
| 无损输出 | `mask_type:"binary"`、`output_video:false`、`output_format:"png"`、`output_frame_interval:1`；PIL 保存 H×W 的灰度 PNG，每帧按顺序 yield |
| 输出帧名 / 顺序 | image sequence 分支按枚举索引生成 `frame_00000.png` 等，HTTP schema 输出为有序 URI 数组；没有 ZIP，因此不能套用 ZIP 成员排序假设 |
| 尺寸 / resize | [video predictor](https://github.com/zsxkib/segment-anything-2/blob/0850d194e6de09803e93694e72ce3004bdfd1429/sam2/sam2_video_predictor.py) 保存来源宽高并把模型 logits 插值回该尺寸；[loader](https://github.com/zsxkib/segment-anything-2/blob/0850d194e6de09803e93694e72ce3004bdfd1429/sam2/utils/misc.py) 内部 resize 不改变声明的最终 H/W，但来源先经 JPEG 帧提取，边界仍是模型推断结果 |
| fps | PNG sequence 不消费 video_fps；不用默认30fps，也不要求整数fps。最终本地 mask 的 fps / 时间映射来自实测原视频 |
| 全帧 | frame0 提示时默认 forward propagation 从0到片段末尾，interval1 时逐帧输出；必须核对实际返回数，不能因源码循环就跳过结果验证 |

部署源码有明确的非零帧错误风险：默认 propagation 从最早点击帧开始，只做前向；保存输出的 zip(frames_generator, masks_generator) 丢弃模型返回的真实 frame_idx，然后重新从0编号。不能把非零 click_frames 直接映射为完整来源 mask。

这不仅来自静态推断。页面及 [公开 examples](https://replicate.com/meta/sam-2-video/examples) 的成功样例 `bn3xep8srnrgp0cha4avc64azr`，输入 click_frames=1，日志源为395帧、propagation 为394帧，与截短风险一致。它输出 highlighted MP4，未下载或解码，不能当作 PNG 像素证据。两个当前公开 examples 都是 overlay 视频；已知旧版本页面 initialPrediction 为 null，未取得精确的成功 binary PNG 样例，也未枚举预测 ID。

另一个更直接候选 [lucataco/sam3-video](https://replicate.com/lucataco/sam3-video) 有 mask_only / return_zip，但其页面链接的 [部署源码](https://github.com/lucataco/cog-sam3-video/blob/main/predict.py) visual_prompt 只解析并打印，没有把点 / 标签送入模型。本批排除它，不能只凭输入 schema 宣称点提示可用。

## 两路 frame0 的最小合同

对实测 N 帧来源，以原 PTS 找到点击秒数对应的最近帧 k。若前端时间正好在片尾，应映射到最后实际帧，保留原点击时间与选中帧 PTS 两者作为 provenance。初版沿用已有严格 CFR 接收范围；VFR 不可先改速再宣称原时轴保留。

物化两个真实片段，输出重计时但保留索引映射：

- 前向 A 的来源帧为 `[k,k+1,…,N-1]`，应返回 N-k 张 PNG；A[j] 对应原 k+j。
- 倒序 B 的来源帧为 `[k,k-1,…,0]`，应返回 k+1 张 PNG；B[j] 对应原 k-j。
- 最终原帧 i<k 取 B[k-i]，i≥k 取 A[i-k]，恰好 N 帧；提示帧 k 去重。
- k=0 时只做完整前向一路；k=N-1 时只做完整倒序一路，逆序映射即可。无需为只有提示帧的冗余一路另付一次推理。

两路都发送同一个中心像素和 foreground 标签，click_frames 固定0。不能只修改 video_url 或用两个 sourceClip 字段冒充物化；必须解码、选取真实帧、受控编码并再次 probe，确认连续帧数、维度和位置不变。准备视频不得隐式旋转、缩放、丢帧、补帧或改变像素坐标。若需规范化旋转元数据，要统一处理来源、选点和映射，并验证显示尺寸。

两路第0帧必须来自同一原帧。建议用已有工具进行受控无损物化，解码后逐像素比较两个片段的首帧，确保再次有损编码没有改变提示画面；不满足则在上传前拒绝。模型内部 JPEG 提取及独立GPU运行仍可能造成边缘差异，因此成功合并还要检查两个返回的第0帧 mask：初版采用**解码后二值像素完全相同才合并**，保留 A[0]，丢弃相同 B[0]。不一致时拒绝并报告识别分支不一致，不取并集 / 交集、不静默忽略、不自动重复付费尝试。这个保守策略可能拒绝实际结果，需后续真实测试评估可用性。

每一路的版本化请求只使用已证字段：

```json
{
  "version": "33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d",
  "input": {
    "input_video": "<已确认上传的实际片段 URL>",
    "click_coordinates": "[x,y]",
    "click_labels": "1",
    "click_frames": "0",
    "click_object_ids": "target",
    "mask_type": "binary",
    "output_video": false,
    "output_format": "png",
    "output_frame_interval": 1
  }
}
```

确认完整返回后，安全下载每张 PNG，真实检查格式、尺寸、色深、解码像素0/255与总字节 / 总像素预算。若文件名在HTTP输出中可取得，应与数组位置的连续 frame index 交叉核对；如果供应商重命名使文件名不可用，只可依据明确有序的 output 数组，不能猜测 URL 字典序或从缺口拼顺序。遇到重复、额外、缺失、乱码、非二值或尺寸不符应拒绝整条分支。

解码后的目标像素按 `y*width+x` 写成零基 start/length RLE，按上面的映射生成 N 个 frames，使用实测原来源 fps，再执行现有完整 mask 校验。不能复制首帧、补尾帧或用框选矩形填缺失区域。这个桥接自行编码已明确的像素，不需要解释供应商未知 RLE。

## 持久任务与成本

[HTTP API](https://replicate.com/docs/reference/http) 支持 POST `/v1/predictions` 的固定 version + input，GET `/v1/predictions/{id}` 与 POST `/{id}/cancel`；认证只发固定 `api.replicate.com` origin。本方案使用异步回执和查询，不依赖 SDK run() 的长连接。创建前持久化提交意图，取得每个 id 后立即保存模型 / 版本 / 方向身份，不使用任意回执URL携带 Key。

父识别任务要有两个方向子任务和 merge 阶段，分别保存物化片段 SHA、实际首帧 hash、原PTS/帧索引映射、输入指纹、version、prediction id、已验证输出清单和下载进度。先取得前一路明确回执后才创建后一路；任一路POST响应丢失后标 unknown，不自动重发或继续创建额外付费任务。重启只查询已知 id、下载未归档文件及恢复纯本地合并；已知成功分支不重复推理，部分 mask 不作为全源 mask 发布。

中间帧通常两次推理，处理帧数合计 N+1，并有两次调度与上下文开销，价格不能直接等同单次 N 帧。取消已运行任务仍可能计费，取消一条不证明另一条停止。失响应和分支失败可能已经产生费用；用户发起识别前应能知道它是最多两条分割任务。选区、来源或项目身份改变仍须遵守现有迟到结果守卫。

[数据保留合同](https://replicate.com/docs/topics/predictions/data-retention/) 默认 API 输入、输出、文件和日志一小时后删除；每条成功分支应立即安全下载并在本地验证 / 归档，不能等另一条长任务结束后才保存第一条。若重启时远程文件已删除且本地未完整保存，标恢复失败，不能自动重新上传 / 推理。价格与取消计费依据[官方 billing](https://replicate.com/docs/topics/billing)；网页当前展示价格仅供当次核对。

Replicate Key 与 fal Key 不通用。采用此方案后是「配置 Replicate 分割服务 + 配置 fal 编辑服务」的闭环；不能继续宣传只填原有 fal Key 就能首次识别。仍需明确完成实际片段上传合同、持久双任务及配置 UI 接入，本批没有实现这些行为。

## 下批实现前的验收条件

1. 固定当前 model version，并保留部署源码映射未完全确认的说明；明确公开 schema 与源码能够支持的能力范围。
2. 实际本地片段 probe / 帧 hash / PTS 映射，覆盖 k=0、中间、末帧和非整数 CFR；异常输入在上传 / 推理前拒绝。
3. 对真实成功 binary PNG 响应验证极性、原尺寸、连续顺序与准确数量；目前只有源码证据，没有公开 PNG 像素实测。
4. 两个子任务恢复、unknown不重发、一小时文件失效、部分下载、取消、提示帧冲突和选择失效测试；两路结果全部通过才发布完整mask。
5. 有授权的真实供应商测试覆盖移动目标、遮挡、倒序跟踪与边界一致性。源码合同证明可实现，不证明模型质量或严格一致性策略的通过率。

本批新增本说明与证据 JSON。来源源码 AST、当前输入 / 输出 schema、公开样例395/394日志核对通过；纯索引映射在N=1/2/5/11的每个k上验证无重复遗漏。没有模型运行、上传、Key、浏览器或新依赖，也没有改共享后端。官方文档通过搜索连接器的公开索引文本读取；直接原始GET遭403，未为这些文档声称原始文件hash。
