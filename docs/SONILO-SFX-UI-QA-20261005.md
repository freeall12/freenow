# Sonilo SFX 前端接线与验收

2026-10-05：保留正式 Sonilo 选择器与 Music / Sound 场景，Sound 由显式供应商路由确定 Sonilo SFX 原生音效或 fal ThinkSound 替代。默认 Sonilo 原生 Music 映射不代表 SFX 可用；缺别名、缺路由或缺 Key 都阻止普通入口和 Agent 确认。

## 合同与界面

- Sonilo SFX 原生：单个 WAV；文字音效 0.5–180 秒可含小数；完整视频按实测时长，官方最大 480 秒，本地最小 0.5 秒与 50 MB 上传预算。
- 音效描述上限 2000 字符，与公开SFX合同一致；Music保持1000。视频可空描述，纯文字须非空。参考只接受一个完整 MP4；不接受文字、图片、音频参考。裁剪/选段须先物化，不用整片替代。
- 原音频目录的普通时长预设和输入范围仍为 1–180 秒。Agent 可明确填写 0.5 秒；视频无需人工扩大目录时长，提交前读取真实时长，原生 profile 支持至 480 秒。ThinkSound 仍受自己的 1–180 秒本地预算约束。
- 音效分段只适用于视频，1–30 项，每项严格为 `{start,end,prompt}`。首 start 为 0，end 大于 start，前 end 必须等于下一 start，end 不超过实测视频；每段描述 1–200 字符。不排序、不补缝、不量化，不接受 Music 标签。
- 普通入口的“音频参数”弹层提供音效分段开始/结束/描述与添加、移除、清除操作。修改后精确预检，非法指令保持可见且禁止提交。已有目录图标复用。
- Agent 确认卡显示真实供应商、单结果、明确时长或视频跟随及全部 start/end/prompt。配置获取期间禁止确认；缺配置、计数/格式冲突、无效分段阻止批准。取消不提交；销毁卡片忽略晚到配置。
- 原始 Agent 不支持的设置、源节点残留参数、promptInfluence、MP3 不会在确认或请求准备时被默默丢弃。准备期间的源节点、参考内容、项目和入边变化继续阻止提交。

## 独立 fixture

```bash
env -i PATH=/opt/homebrew/bin:/Users/laplace/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin TMPDIR=/tmp node scripts/qa-sonilo-sfx.cjs
node --test tests/sonilo-sfx-native-ui.test.cjs
```

fixture 启动在随机 loopback 端口，使用独立临时 durable 目录、显式 SFX-only 模型映射和代码内合成凭据。仓库 `qa/trim-scenes.mp4` 是 8 秒 MP4；输出为同长 PCM16 正弦波，不调用真实供应商。HTTP 接缝保留官方 origin 身份，但仅把请求转发到独立本地 fixture；CDN 请求不带 API 鉴权。

页面使用正式画布、AudioAPI.buildRequest、GenerationAPI 与 Agent 确认卡。顶部 fixture 控件创建节点、配置连续分段、文字 10 秒、Agent 文字 0.5 秒、明确视频 5 秒冲突、缺 Key、缺路由、2 结果、段缺口、未物化选区、Music 未路由与重开 gateway。普通生成必须点击正式“生成音频”。`/api/qa/sonilo-sfx-audit` 给出原请求字节一致性、完整段指令、原任务查询与媒体读取事件。

## 当前证据与边界

2026-10-07：SFX backend13项、Agent schema3项、native UI4项，共20项；受影响Music最小回归4项全部通过。SFX 覆盖：直接/路由 profile 的资格边界；Agent 小数时长与不丢指令；正式 buildRequest 240.25 秒视频、实测时长、零读字节失败与源/项目漂移；正式卡片 DOM 配置等待、缺 Key、全部边界、取消与销毁。修改的 JS / MJS / CJS 语法检查通过。独立 fixture 已在干净环境启动，最新运行页面为 `http://127.0.0.1:59084/`（PID91122，fixture upstream59083；临时store `/tmp/sonilo-sfx-browser-o75Xz8`）。随机端口和PID只描述本次运行，重跑以脚本输出为准；未动4173。

前后端共识：正式选择器virtualModel=`sonilo-music`或显式`sonilo-sfx`均可通过SFX资格校验；实际model仍须`sonilo-sfx`，scene须`Sound`。只对明确匹配Sonilo Sound的Agent指令接受0.5–0.99秒；其他音频仍保持1秒下限，SFX+Music/TTS场景拒绝。正式AudioAPI生产请求经HTTP JSON序列化进入真实provider的定向检查已经通过，避免两套独立检查各自通过而无法对接。

固定浏览器操作：创建视频→音效节点；单结果+音效分段；正式音频参数查看/修改start/end/prompt；正式生成音频；播放；重开gateway与刷新恢复；先点文字音效10秒清空视频边/分段，再开Agent文字0.5秒并确认；缺Key、缺路由、2结果、分段缺口、未物化clip和Music未路由应保持零新增POST。

2026-10-07 Computer Use：正式音频参数将连续分段边界由3.25改为3.5秒，并修改后段描述。正式生成提交8秒完整MP4，fixture核对上传字节与源文件一致，提交段为0–3.5秒「连续脚步声」和3.5–8秒「风声与树叶摩擦」，单个WAV结果原生播放（duration=8、readyState=4、播放时间前进）。重开gateway和页面刷新后恢复同一任务、节点与播放器。

随后通过文字10秒控件清空视频参考和分段，从正式Agent确认卡提交0.5秒文字音效。单WAV完成并原生播放（duration=0.5、readyState=4）。下载分别为256044/16044字节，CDN下载均未带供应商Authorization。切换缺Key配置后「生成音频」明确禁用并显示缺少GENERATION_API_KEY；后台累计仍为2次生成POST，没有第三次调用。其余非法配置零提交边界依据定向回归，未逐个宣称本次鼠标验收。

浏览器操作证明正式参数编辑、任务/媒体播放和恢复链。没有真实 Key、付费接口、真实供应商音质、账号权限、费用或长视频在线能力验证。固定正弦波仅证明任务/媒体合同，不证明音效对画面匹配。
