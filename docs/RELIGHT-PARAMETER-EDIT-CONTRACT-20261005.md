# 重新打光：原参数与独立编辑契约 · 2026-10-05

本轮保留原站26主光位、三档亮度、六档色温和背部三点轮廓光。已新增独立 `openai-relight-native`，公开语义为 **`parameter-prompt-edit`**：将全部有效参数编译成英文图片编辑指令，上传真实源图片执行 `images.edit`。这属于独立模型实现；没有证据证明它复现 TapNow 私有模型，或物理精确兑现角度、百分比、Kelvin。

本文补充 [IMAGE-RELIGHT-NATIVE-20261005.md](IMAGE-RELIGHT-NATIVE-20261005.md) 的公开供应商核查。该旧文关于四个专用打光端点的参数缺口仍成立；其“本轮只新增说明、不猜测提示词”的描述是此前批次状态，本批按用户授权实施显式参数编辑模式。四方向 BRIA 模式不能替代标准26光位。

## 可复核来源

只读本机安装包、已有抓取文件和已安装 SDK，没有运行远程脚本、读取私有用户数据、供应商 POST 或浏览器操作。

| 来源 | 定位 | 本次核对 |
| --- | --- | --- |
| `/Applications/TapNow.app/Contents/Resources/web/assets/course-api-base-url-CGXqZmAy.js` | `LF.relight`、`ql.RELIGHT`、图片节点 `nte`、关闭容器 `XI` | 私有接口 wrapper、完整 source 传入与 Escape 关闭；SHA-256 `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca` |
| `reference/vendor-pkg-canvas-relight-CbCBWpQQ.js` | `Ut/Bt/ce/se/Ve/ye/te/pe/We/je/Ai/ei` | 标准位置、资格、控件、状态与回填；SHA-256 `27393bc157dc6524fc397f7a3fb5f2d0ce0b967f190a10cc45712bb22330cd47` |
| `node_modules/openai/src/resources/images.ts` | `ImageEditParamsBase`，569–688行；已装 SDK 7.20.0 | 编辑上传、模型、输出与尺寸契约；无需再次公开 GET |
| `image-relight-core.mjs`、`image-relight-stage.mjs`、`image-relight-ui.mjs` | 当前工作副本 | 已对照参数和预览；专项记录见[独立协议](OPENAI-RELIGHT-NATIVE.md)与[预览性能](RELIGHT-STAGE-FRAME-ALLOCATION-20261005.md) |

## 完整主光位

方位角以图片正前方为0°，右为90°、后为180°、左为270°；俯仰角向上为正。Three.js 预览坐标为 `x=r·cos(el)·sin(az), y=r·sin(el), z=r·cos(el)·cos(az)`，半径6。

| azimuth | elevation 0° | elevation +45° | elevation -45° |
| --- | --- | --- | --- |
| 0° | `front_0` | `top_front_45` | `bottom_front_45` |
| 45° | `right_45` | `top_front_right_45` | `bottom_front_right_45` |
| 90° | `right_90` | `top_right_45` | `bottom_right_45` |
| 135° | `right_rear_45` | `right_rear_top_45` | `right_rear_bottom_45` |
| 180° | `back_180` | `top_rear_45` | `bottom_rear_45` |
| 225° | `left_rear_45` | `left_rear_top_45` | `left_rear_bottom_45` |
| 270° | `left_90` | `top_left_45` | `bottom_left_45` |
| 315° | `left_45` | `top_front_left_45` | `bottom_front_left_45` |

另外两点为 `top_90=(0°,90°)`、`bottom_90=(0°,-90°)`。原站六个快捷按钮按左侧、顶部、右侧、前方、底部、后方排列；其余光位由预览拖动获得。主光拖动每屏幕像素改变0.8°，俯仰限制±90°，释放吸附到方位八档、俯仰五档。`We` 在±5°内识别标准位；识别上下极点时忽略方位角。

## 轮廓光精确资格

`pe/Bt` 是以下十个坐标的白名单，每个坐标的方位圆周差和俯仰差均须≤5°：

| 主光 preset | azimuth / elevation |
| --- | --- |
| `front_0` | 0° / 0° |
| `left_90`、`right_90` | 270° / 0°、90° / 0° |
| `top_90`、`bottom_90` | 0° / +90°、0° / -90° |
| `top_front_45` | 0° / +45° |
| `left_45`、`right_45` | 315° / 0°、45° / 0° |
| `top_front_left_45`、`top_front_right_45` | 315° / +45°、45° / +45° |

资格不包括所有45°光位，特别不含下前45°、上左/右45°或后方位置。源函数在上下极点仍校验方位角；自由坐标 `(225°,90°)` 可被识别为 `top_90`，但不通过原始 `rimAllowed`。标准 preset 请求必须从表中取其规范坐标，避免审批、预览和后台资格不一致。

`rimPreset` 只有 `back_0=(180°,0°)`、`top_back_45=(180°,45°)`、`low_back_45=(180°,-45°)`。轮廓光拖动锁方位180°，俯仰限制±45°，释放按最近位置吸附。主光进入不允许位置时自动关闭轮廓光；移回允许位置保留关闭状态，必须手动打开。关闭轮廓光时仍保留选中的 `rimPreset`，不意味着产生背光。

## 亮度、色温与控件

- 亮度为 `10/50/100`；色温为 `2000/3000/4000/5600/7000/8000 K`。不是连续数值输入。
- 初值及重置值：`front_0`、50%、5600K、`rimEnabled:true`、`rimPreset:back_0`。HTTP wrapper 单独缺省 `rimEnabled:false`，其余为50、5600、back_0；两层缺省不可混同。
- 132px轨道按 `round(x/width·(档数-1))`选档，数值区横拖每20px移动一档；屏幕坐标计算不随画布缩放变成世界坐标。
- 色温预览色依次为 `#D7995D/#D5AE55/#F3DB90/#F3F9FC/#D4E6EE/#C4E2F0`。预览亮度强度映射为10→0.35、50→1、100→2.2，**不是后台曝光变换定义**。
- 原站重置只重置参数，不重置透视/正面视角或当前拖动目标。面板支持 `initialParams`，更新输入时归一化再同步；`parametersLocked` 禁止编辑参数，视角切换独立。
- 原站价估计通过模型`relight`/provider`tapnow`查询，生成按钮以真实估计反馈；本地不能把抓取的20点数当成 OpenAI 固定价格。

## 请求、关闭与 source 生命周期

原站请求为 `{fileId:src, angle:{preset}, brightnessPercent, temperatureK, rimEnabled, rimPreset}`，不提交自由角坐标。当前安装包的图片节点 `nte` 从 `data.src` 取值，直接传入 `RelightFeature`；打光模块将该值用于完整纹理加载和 `fileId:src`，没有 crop 或 selection 处理。`fileId` 字段名不能单独证明它是文件ID。原站编辑的是节点当前有效完整 `src`；本地若保留未物化的裁切/选区元数据，须先导出对应真实图片，不能提交未裁切原图冒充。

生成时创建右侧gap200连接图片占位，记录任务状态，下一动画帧关闭源节点mode并移镜至结果；`code===0 && data.fileUrl` 才回填并登记来源节点。失败删除占位，区分图片尺寸未知/过大、内容拒绝、余额和服务器忙。原站独立策略检查字段含 `anglePreset/azimuthDeg/brightnessLevel/temperatureK/rimEnabled/rimPreset`，没有显式elevation；本地完整审批仍须展示准确主光位置。

Close按钮直接调用外层 `onClose`。当前安装包的外层 `XI` 已证实在 capture 阶段监听 Escape，调用 `fitView({nodes:[{id:nodeId}],padding:5,duration:500})`，50ms 后执行 `onClose`；图片节点的关闭回调清除 `mode`。预览卸载取消RAF、销毁Three.js资源；source变化清理旧纹理，异步纹理加载晚到时需防止写入已销毁的预览。选择变化、source换图和持久化的其他外层规则仍未从本轮有限来源确认。

原站预览拖动只绑定 `onPointerUp`；轨道/数值拖动仅绑定 `onPointerUp` 并用 window `pointerup` 复位，没有 `pointercancel` 或 `lostpointercapture` 处理证据。因此不能宣称原站在取消时提交吸附或回滚；本地处理取消和失去捕获属于独立增强规则，其视觉一致性仍需验证。

本地已保留source快照与身份检查，并实现 readiness、参数存储和准备期间的关闭保护。关闭面板表示结束编辑/释放预览，不能宣称已取消发出的付费请求；源图或目标节点后来改变时，不覆盖其现内容。读取私有`asset:`/blob的真实字节后再上传，不能把本地引用作为远端可读URL。

## OpenAI 独立编辑边界

已装官方 SDK 的 `images.edit` 输入是 `Uploadable | Uploadable[]`，GPT模型源图片为PNG/WebP/JPG且每张<50MB；本功能限一源图和一个结果。SDK模型枚举含`gpt-image-2`。`output_format` 支持PNG/JPEG/WebP，GPT模型始终返回base64；`response_format` 是DALL·E-2参数。`gpt-image-2` 明确忽略 `input_fidelity`，不能用该字段承诺主体无变化。

`size:auto` 是自动尺寸请求，不证明源像素尺寸或精确画幅保持。SDK支持`gpt-image-2`任意`WIDTHxHEIGHT`，但宽高须16倍数、画幅1:3至3:1且满足当前像素/边长限制；自动尺寸和自定义尺寸均需真实返回尺寸验收。

独立编译必须含主光的具体左右/前后/高度、亮度百分比、Kelvin、轮廓光启停及开启时的位置，并说明仅调整照明、尽量保留主体、构图、细节。用户选择值、审批快照、实际编译参数必须一致；不允许默默将26位缩成四方向，或把默认亮度/色温当作无需发送。未知字段、无效枚举和不允许的rim组合须在外发前明确拒绝。

**Unknown：**原私有后端的模型、提示词、参数转换、光照精度、原尺寸约束、计费和服务端恢复合同。**未验：**真实 OpenAI 调用、主体一致性、各光位可区分性、百分比/Kelvin的画面效果、图像质量与视觉等效。模拟响应、预览和契约测试只能证明本地流程，不能关闭这些验收项。
