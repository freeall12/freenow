# 视图管理菜单合同

独立 Saved Views UI 未在安装包定位。本菜单为本地补齐，领域语义来源见 `docs/research/STUDIO-V3-SAVED-VIEWS-20261008.md`。复用已有菜单、按钮与 `icons.mjs` 的原图标，不提供伪缩略图，不拍照或发起模型生成。

## 接口

```js
const element = createSavedViewMenu({
  read: () => ({
    items: [{id, label, stageId, setupId, stageLabel, setupLabel, camera, tags, active, createdAt}],
    activeViewId, canSave, busy, disabledReason,
    pendingSave: null // 或 {viewId, action, label?, message?}
  }),
  onSave: () => saveCurrentVisibleCamera(),
  onRestore: id => restoreStoredViewCamera(id),
  onUpdate: id => updateStoredCamera(id),
  onRename: (id, label) => renameView(id, label),
  onRemove: id => removeOnlyView(id),
  onSelect: id => selectWithoutMovingCamera(id), // 可选；提供时显示“选中”按钮
  onRetrySave: () => retryPersistenceOnly(), // 宿主保留保存失败回执时提供
  onError: error => reportError(error)
});
```

返回原生 section DOM；`element.element === element`，支持读取 `.element`。`.refresh()` 从宿主重新读取真实内容，不覆盖编辑草稿和输入选择。`.dispose()` 永久令此实例 inert，移除处理器并隔离所有迟到结果；回执仍由宿主持有。`.handleEscape()` 依次取消删除确认、取消重命名，各返回 true；普通态返回 false，让宿主关闭父菜单。输入法合成时不消费 Escape。

回调可同步或异步。只有 `true` 或 `{ok:true}` 为成功；`false`、undefined、`{ok:false,message}` 和抛错均显示真实错误。组件只读回调之后的宿主数据，不本地伪造名称、相机、active 或已持久保存状态。所有行操作传启动时的固定 View ID；同一实例任意操作 pending 或宿主 busy 时拒绝重复。

`canSave === true` 才能新建及“更新为当前视角”；它不限制已有 View 的恢复、重命名、删除或可选选择。宿主必须自行复核实际许可、相机来源、关系和租约。`pendingSave` 存在时，顶部按钮变成“重试保存视图”，busy=false 且存在 onRetrySave 即可点击；其余行操作禁用。重试只调用 onRetrySave，不再发起 create/rename/remove。`{ok:false,applied:true,...}` 仍显示错误并读取真实已应用数据，包括已移除的 View。

重命名由实际 input 保存草稿，Enter/blur 提交并 trim；合成期间不提交。空名显示错误，失败保留草稿与焦点；Esc 丢弃草稿。保存名称按钮的 pointerdown 保持输入焦点，避免与 blur 重复提交。删除按钮同样保持草稿；确认取消先回到输入，下一次 Esc 才取消重命名。删除确认明确“只删除此视图，不删除机位、照片或所属状态”。

## 宿主接入与验收定位

使用现有 menus，以 `{role:'presentation', width:320}` 或 360 承载原生控件。section 不接管菜单位置；宽度与移动端夹紧由宿主负责。保留现有菜单外壳的 bg-popover 50%、18px radius、28px blur；不复用镜头管理面板的独立大卡片外壳。滚动、outside dismiss、父菜单焦点回返由 menus 负责。标题和所属状态/元数据均限制单行溢出，真实长名仍保留在 title 和 aria-label；缺少光学字段明确“焦距未提供／画幅未提供”，不补造默认值。

实机定位：

- section `[aria-label="视图管理"]`，行 `[data-view-id="<id>"]`。
- `button[aria-label="保存当前视角"]` / `button[aria-label="重试保存视图"]`。
- 行内 `button[aria-label='恢复视图“<label>”']`；`aria-pressed` 表示实际选中，点击已选 View 仍恢复相机。
- 行内 `button[aria-label='重命名视图“<label>”']`、`input[aria-label='视图名称：<label>']`、`button[aria-label='保存视图名称“<label>”']`。
- 行内 `button[aria-label='更新视图“<label>”为当前视角']`、`button[aria-label='删除视图“<label>”']`。
- 可选 `button[aria-label='选中视图“<label>”']`，只选中不恢复。
- `[role="alertdialog"]` / `button[aria-label="取消删除视图"]` / `button[aria-label="确认删除视图"]`。
- `[role="alert"]` 为操作失败；`.sv3-saved-view-reason` 为宿主门禁或保存回执说明。

DOM focused 验证：`node --test tests/studio-v3-saved-view-menu.test.cjs`。覆盖真实 DOM 交互、固定 ID、native button、焦点/分层 Escape、IME/blur/pending、长中文 accessible label、应用后保存失败重试、关闭迟到结果。没有 CSS 镜像断言。浏览器视觉、移动端几何及真实 session 保存重开仍由宿主集成验收。

宿主接线已完成；真实生产菜单、跨状态恢复、保存失败原回执重试与刷新重开证据见[集成验收](../../../docs/verification/20261008-studio-saved-views.md)。本文件专项范围与集成验收分别记录。
