# Agent 片场 2.0 本地导入、网格与重做

依据：官方安装包的 `reference/studio-v2-page-readable.js` 模型导入入口（1222–1240 行）、地面网格菜单（1325 行）、运镜历史重做（822–826 行）；本地已有 `inspectModel`、`SceneRuntime.addObject`、`setGrid` 和 `undo(true)`。本轮将已有本地功能暴露给 Agent，没有增加界面图标或依赖。Agent 直接选画布素材是本地工具适配，不声称官方具有同名工具。

`scene_read` 返回 `sessionId`、`revision`、`savedRevision`、`history.canUndo/canRedo`、`supportedImportFormats`、`supportedImportSources` 和 `supportedEnvironmentProperties`。重新打开片场会产生新的 `sessionId`，因此 revision 数值相同也不能复用旧会话的写入参数。

## 导入真实模型

```json
{
  "sourceNodeId": "实际画布3D资源节点ID",
  "sessionId": "scene_read返回的sessionId",
  "expectedRevision": 3,
  "properties": {
    "name": "布景",
    "position": [2.375, 0, -0.123456789],
    "rotation": [0, 1.5707963267948966, 0]
  }
}
```

`scene_import` 必须提供 sourceNodeId、sessionId 和 expectedRevision。源必须是当前画布中带 `worldResource.format: "glb"` 的真实 world 节点，资源来自本地 asset 存储或同源静态地址。工具不接受任意 URL、外部地址或虚构模型。可选 `sceneIndex` 与 UI 的场景选择一致；properties 仅接受 name、position、rotation、scale。Agent 的旋转为 XYZ 弧度，runtime 按现有 UI 的度数接收，位置为父级局部坐标；新导入根对象的父级是场景根。

读取字节后仍经正式 glTF 检查和合并后 12 MiB 导出预检。来源节点替换、资源变化、场景版本变化、关闭或取消均在首次修改前再次核对。取消可中断 fetch；glTF 解码和容量预检完成后也会核对取消，不会回填。已有 Studio ID 在导入前清除，重复导入生成独立对象 ID。

目标也绑定打开片场时的实际节点对象与 studio 类型。画布删除后撤销恢复的同 ID 新对象不会接收旧运行时结果。`flush` 在异步 GLB 导出、asset 存储、宿主更新和画布保存后分别核对身份；宿主 `updateNode` 原地修改同一节点，正常连续保存不会误判为替换。

成功返回实际对象 id、sourceNodeId/sourceAsset、sceneIndex、sessionId、revision、savedRevision。真实文档保存 `userData.studioImport` 来源信息。保存失败且本地已应用时返回 applied:true 和 entityId；不能把失败当成未应用而直接重放。未应用失败不会增加撤销记录。

## 网格与光照

`scene_environment` 在 V2 支持 `ground: {grid: boolean}` 与现有 `lighting: {azimuth, elevation}` 的任意有效组合。其它 ground、room 或旧版 HDR 环境字段仍整体拒绝。混合请求在首次修改前全部验证，并只记录一次撤销、一次 revision 提交和持久保存。数值不变返回 applied:false。网格菜单也使用同一可撤销 setter。

## 重做

`scene_redo` 接受必填 `sessionId`、`expectedRevision`。使用现有文档历史的 `undo(true)`，保留对象、动画、画幅、灯光和网格的统一顺序。异步恢复完成后、替换文档前再次核对取消与版本。返回实际 revision、savedRevision 和 canUndo/canRedo；没有可重做历史时 applied:false。保存失败会报告已应用。

## 本轮验证边界

5 项核心检查使用真实 Three.js GLB 导出/加载和实际 runtime 事务，覆盖精确变换、独立 ID、来源/版本变化、异步预检取消、保存失败回执、混合环境原子性与真实撤销重做。新增同 ID 目标替换在导入预检、GLB 导出和 asset 存储阶段的回归，以及正常原地宿主保存。另运行已有边界/生成应用/设置回执中的 4 项相关检查和历史恢复中的 2 项相关检查。模块语法检查通过。

没有运行 E2E、浏览器、GPU 画面或真实模型导演循环，不能据此宣称视觉验收或完整片场能力。相机 imported projection 光学仍为只读；V2 的 HDR/房间环境和旧版多方向渲染没有因本轮被开放。
