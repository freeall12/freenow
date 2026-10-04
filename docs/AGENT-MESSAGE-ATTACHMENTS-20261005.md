# 已发送消息附件 · 2026-10-05

正式消息现保留已发送图片与视频的缩略条。已有上传、LocalAssets 存储和会话 uploads 身份沿用；没有新增上传格式、远程回源、点击预览或生成授权。

## 官方依据与实际缺口

官方发布包 `reference/vendor-pkg-canvas-CwfaULgq.js` 的 `MessageItem` 在正文前调用 `Nre / AttachmentThumbRow`，`oF / MessageThumbRow` 采用12px间隔与横向滚动，`Rne / AttachmentThumb` 采用48×48、6px圆角、object-cover。视频缩略失败后使用 muted、playsInline、metadata视频，定位 `#t=0.1`；最终采用类型图标。原组件为展示缩略，不含点击预览。源码摘录、字符位置与整包SHA见 `reference/agent-message-attachments-source-20261005.json`。

本地原 `agent-client.js` 已保存每条用户消息的 uploads，但正式消息渲染从未绘制它们；草稿 attachmentStrip 不能代替发送后的消息归属。本次仅补这个缺口。视频图标复用官方 referenceIcons，文件回退复用既有Tabler图标；未设计新SVG。

## 实现与边界

- `src/features/agent-messages/attachments.mjs` 用真实本地素材身份解析图片/视频，URL成功后保持loading直到浏览器实际load/loadeddata；解码失败或素材缺失保留原槽位与名称，退回类型图标。未知文件类型也保留槽位。
- 远程URL、危险协议及跨源blob在解析前拒绝，不从旧URL取素材，也不改写原消息。共享LocalAssets继续拥有blob URL，缩略清理不撤销其他消费者的地址。
- 正式 `messages.mjs` 使用消息key及附件身份内容复用缩略DOM；普通重绘、模型等待及流式更新不重复解析或解码它。更换附件身份、切换会话、关闭或销毁renderer会释放媒体；迟到解析不能插入旧会话。
- 48px槽位、12px间隔、窄视口横向滚动在 `styles.css`。纯文本、原子引用、复制/反馈/分叉、模型请求及现有公共宿主合同沿用。

## 定向检查

`node --test tests/agent-message-attachments.test.cjs tests/agent-message-stream.test.cjs`：13项通过。覆盖真实解析合同、图片/视频load状态、坏媒体回退、远程零解析、缺失与未知类型、迟到关闭、相同DOM一次解析、会话切换释放及既有九项流式消息行为。DOM测试不等于真实浏览器解码验收。

相关旧回归 `tests/agent.test.cjs tests/agent-browser-tools.test.cjs tests/agent-stream.test.cjs`：95项中93通过，2项失败：pagehide旧VM夹具缺少 `templateSourceRuntime`；interactive HTML SDK的 `/not allowed/` 预期拒绝未出现。两处均未由本批修改，本批没有据此宣布全部回归通过。

## 隔离生产组件验收入口

公开入口 `/src/features/agent-messages/qa/agent-message-attachments.html` 直接使用正式消息renderer与LocalAssets，独立素材数据库 `qa-agent-message-attachments-20261005` 与会话数据库 `qa-agent-message-attachment-conversations-20261005`。固定会话只在显式准备按钮保存；不会占用生产localStorage配额，不调用模型或改画布。

1. 点“准备真实本地素材”，将已有官方人物图片及固定本地测试视频字节写进独立素材库；显示图片/视频、缺失asset、旧远程引用、未知文件和长附件行。
2. 检查图片自然尺寸、视频readyState/实际帧与48px槽位；旧远程槽位保留fallback，网络应没有原站请求。缩略视频无播放器控件，不自动播放。
3. 点“重绘消息”，收据 `sameVideo:true`，媒体节点与解码状态保留；缩窄视口检查附件行滚动，正文不被遮挡。
4. 刷新页面后点“恢复已保存测试会话”，重新从本地素材库解码；点“切换为空会话”释放媒体。

主线程真实Computer Use已通过：图片自然宽200px，视频320px且readyState4；16个缩略槽的真实解码与失败状态正确。实际点击重绘得到 `sameVideo:true`；刷新后恢复16个槽位，切换空会话后缩略为0。见[实际附件截图](screenshots/agent-message-attachments-20261005.jpg)。本次只证明正式消息组件的本地媒体与恢复流程，不代表真实模型供应商或全站视觉验收。
