# 当前交互窄清点 · 2026-10-08

初始清点核对当前文档、近期验收记录与源码；后续修复及定向验证见各项记录。本轮未运行全库测试或真实供应商。已发布 [macOS arm64 Alpha](https://github.com/freeall12/freenow/releases/tag/v0.1.0-alpha.1) 和 [开发进展推文](https://x.com/Nokia0421/status/2107767047107346512)；实际安装包退出释放 4183、片场 X=1.25 重开恢复的范围见[安装包记录](releases/DESKTOP-ALPHA-VERIFICATION-20261007.md)。

## 不重复列为缺口

Sonilo Music/SFX 原生接入、Agent 调色保存/重试、分组持久恢复、人物走位基础拖动与边缘吸附、右键菜单短视口键盘滚动、搜索 hover 高亮优化，已有当前实现或专项记录。不能沿用早期“未实现”陈述。当前[有效缺口](CURRENT-FUNCTION-GAPS-20261003.md)已注明这些增量。

## 仍需区分的范围

| 项目 | 当前依据与性质 |
| --- | --- |
| 单音频节点独立拖动 | 已修复外围空白拦截；真实上传 3 秒 WAV 后，空白拖动、波形定位、撤销/重做与刷新坐标/媒体恢复已验。11 项定向检查通过，见[专项记录](AUDIO-PLAYER-GESTURES-20261008.md)。 |
| 普通节点直接标题编辑 | 已还原选中输入、未选中静态标题和防抖提交；实机音频 Enter/立即撤销重做、Escape、刷新已验。5000 个未选中节点零编辑 DOM，首次选中才建控件；20 项专项检查通过。真实系统 IME、多类型/全部缩放仍未验，见[模块记录](../src/features/canvas-node-titles/README.md)。 |
| 搜索分类焦点下的 Enter 确认 | 沿官方根事件修复，14/14 定向回归通过；分类、其他结果与清除按钮焦点三条实机路径均确认当前高亮，空结果/两级 Escape/回焦已验。真实系统 IME 未验，见[专项记录](CANVAS-SEARCH-KEYBOARD-20261008.md)。 |
| 92 份精确模板正文 | [模板来源审计](AGENT-TEMPLATE-SOURCE-AUDIT-20261005.md)仍缺原文；已有本地编辑/导入入口，不能把资源缺口当成编辑器缺失。 |
| Sonilo stems、语音保留、ducking | [SFX 合同](SONILO-SFX-NATIVE-20261005.md)与 `server/generation-sonilo.cjs` 仍明确不接受这些结果/设置；Music/SFX 基础接入已完成。 |
| SPZ 压力、按页流式加载与真实供应商质量 | [LOD 记录](SPZ-LOD-20261005.md)区分 25 万绘制预算和全量驻留；基础渲染/LOD 已实现，复杂压力与真实模型效果仍需独立验收。 |

## 已修复并实机核对：搜索分类焦点下确认当前高亮

官方来源为本机已安装 TapNow **0.4.81** 的 `Contents/Resources/web/assets/page-DVqoHdTT.js`，SHA-256 为 `8334adc98d6ec24265d45ed4f45458be19d137b5391e5b3abb77e064d221cd86`。这里只读安装资源，不请求原站接口、不保存或发布整个 bundle。

官方 `gbe` 搜索弹层把 `j` 接到根 `onKeyDown`；其 Enter 分支无输入框目标限制，调用 `preventDefault()` 后用 `P(E)` 确认当前高亮。读取时 `gbe` 定义位于解码后 JS 字符区间 1547988–1553896（字符偏移，非行号或字节偏移）。

修复前，本地 [搜索 UI](../src/features/canvas-search/ui.js) 的弹层 keydown 仅在 `event.target===input` 时处理 Enter；分类按钮 click 会设置 `active=0` 并重新渲染。已有上下键与 hover 使用同一 `active`，因此焦点落在分类按钮时产生不同结果。

原差异复现：准备至少两个视频节点，打开搜索，点击「视频」分类，按 ArrowDown 高亮第二项，再按 Enter。官方根事件确认第二项；修复前本地会触发分类按钮的原生 click，重置第一项。修复后弹层统一阻止默认点击并用 `choose(active)` 确认高亮；Tab 焦点保持独立，不新增 onFocus 同步（官方结果按钮也无此处理）。

实际改动仅移除 Enter 的输入框目标限制，保留事件归属和 IME 守卫。新定向回归修复前 4/8 失败，修复后 8/8 通过；加上已有搜索和 hover 回归共 14/14 通过。固定内存节点的实机入口为 [搜索键盘 QA](http://localhost:4195/src/features/canvas-search/qa/keyboard.html)：主任务实际分类焦点、Tab 到图片 A 但高亮图片 B、清除焦点的 Enter 均得到 `image-b`；空结果不关闭，两级 Escape 后焦点返回打开按钮。中文输入法仍未实机验。精确操作、截图与边界见[专项记录](CANVAS-SEARCH-KEYBOARD-20261008.md)。
