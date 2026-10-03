# 本地音频、Agent 图层与片场保存恢复

本批继续创作功能与完全本地化。正式设计仍以官方发布内容为依据，localhost 仅用于验收实现；新增 Agent 图层接口属于本项目独立实现，不声称取得官方同名工具合同。无需新增依赖或真实模型 Key。

## 已验证的音频本地修复

旧音频节点提供「导入本地音频」，不再用失败播放器占据修复入口。用户文件经过真实解码、波形解析、本地 asset 写入与 SHA/长度/MIME 回读，更新 `audioDuration` 秒及 `durationMs` 毫秒，保持标题、尺寸、坐标、参数、其他节点和连线。迟到解码、目标或项目变化、保存失败重试都有守卫。

Computer Use 在正式主壳、独立 IndexedDB 内通过原生文件选择器导入本机合成 PCM WAV（440Hz、源 48kHz、单声道、192044 字节）。浏览器解码为约 1.999977 秒/44.1kHz；界面明确说“解码采样率”，原文件字节不改。真实播放器从 0.182 秒播放至 2 秒/ended；波形为 decoded。实际 CanvasStore 回读确认一条连线与另一个旧节点不变，280×230 的节点尺寸保留，单次撤销。

刷新后 asset 身份保留、Blob URL 更换、波形重新解码；撤销恢复旧来源/123 秒与导入按钮，重做恢复本地波形。截图 `/tmp/freenow-local-audio-repair-20261003.png`。未声称主观听音质量、模型产物或全浏览器网络零请求；fixture 的 externalAttempts 仅覆盖其包装的 fetch。

专属 6 项检查通过；播放器退场的独立最小复现确认迟到 URL/波形不回写。主线程更新旧 VM harness 以提取实际来源策略，音频渲染/工具栏 9 项通过，包括稳定按钮、局部重建与原站→本地→撤销的播放器切换。见 [音频合同](NODE-AUDIO-REPAIR.md)。

## 已验证的 Agent 跨组移动

`image_editor_edit` 新增 `reparent`，显式指定单个图层、目标组或根层、插入位置。复用真实 Fabric 树、编辑会话/版本保护和普通写工具确认，不授予只读子 Agent 修改能力。循环、锁、移出组内最后一层和无法保持的容器合成效果明确拒绝；插入位置本身可以有意改变层间遮挡。

真实生产 bridge/Fabric 操作将琥珀图层从嵌套 `inner` 移至 `target-group` 的 index 1，全部叶子矩阵最大误差 `5.684341886080802e-14`，画布节点世界坐标保持 `(52000.25,-1800.5)`；截图观察五块几何位置无漂移，分组缩略图成员改变。一次撤销恢复原树/零矩阵误差，重做后保存 `saved:true/currentMatches:true`；关闭重开和页面刷新后层级/位置保持。

截图 `/tmp/freenow-reparent-before-20261003.png`、`/tmp/freenow-reparent-after-20261003.png`、`/tmp/freenow-reparent-reloaded-20261003.png`。独立审查发现 ActiveSelection 包装效果遗漏，修复后原生 Fabric 最小复验通过；Group 15 项、schema/中文回执 5 项通过，图片 bundle 已构建。此证据不代表真实 LLM 编排已经验证。见 [跨组合同](AGENT-GROUP-REPARENT-20261003.md)。

## 已验证的片场保存恢复

补齐官方保存错误条中的“放弃修改并重新加载”。仅在资产和画布持久化确认后推进保存基线；只读原数据库中的当前已提交场景，避免改变全画布 CAS 基线。候选 GLB、视角与动画先加载校验，再替换场景并释放旧资源；目标/项目变更、坏数据和冲突保留当前编辑。独立审查关闭了全画布 CAS 污染及坏 viewer 设置造成部分破坏的问题。

Computer Use 使用当前正式主壳、页内偏好设置和独立真实 IndexedDB，测试几何是本机生成的红立方体、相机及 2 秒运镜。一次资产写入失败后 X=2/revision=1/savedRevision=0；点击正式放弃按钮恢复 X=0/revision=2/savedRevision=2，返回、刷新、重入仍为 X=0。第二次失败点击正式“重试保存”后 X=2/revision=1/savedRevision=1，返回刷新重入仍为 X=2。镜头与所选运镜保留；播放后正式按钮显示“暂停运镜”，画面为真实红立方体。

截图 `/tmp/freenow-scene-save-error-20261003.png`、`/tmp/freenow-scene-recovered-20261003.png`、`/tmp/freenow-scene-retry-reloaded-20261003.png`。现场故障是 `LocalAssets.put` 单次拒绝，不冒充宿主画布写入故障或跨窗口并发现场证据；后者由定向测试覆盖。21 项受影响检查通过，关闭/变换保护补充单项通过，独立复核未发现新 P1/P2。只包装 fetch 的 fixture 记录不等于全浏览器请求审计。见[保存恢复合同](STUDIO-V2-SAVE-RECOVERY-20261003.md)。

## 本批边界

完整官方模板正文、SPZ 渲染、所有交互状态和真实供应商联调仍未关闭。官方片场的透明区域穿透、Line/Points 点选已有新的精确源码差异，本批不把它们标为完成。最终 freenow 名称、Logo 与应用生成水印替换仍遵照功能完成后的顺序。
