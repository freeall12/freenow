# Studio V3 历史照片只读相册：源合同与本地组件 · 2026-10-08

## 结论

官方确有独立历史照片相册，不能替换成生成历史或镜头管理。它由底部取景器动作组的“历史照片”按钮打开，仅已有照片时显示。相册只显示既有图片，不恢复相机、不重渲染、不生成资产、不保存View；没有导出／下载／删除／重命名入口。本地组件仅还原此只读gallery，并在显示之前校验本地资源及真实图片解码。

当前快门直接添加照片到画布，不追加historicalPhotos。`worldSpace.views`是相机快照，`historicalPhotos`是兼容图片集合，生成历史是3D模型对象选择入口；三者不能共用假数据或按钮。

本轮只静态阅读已安装的官方JS、已有研究和本地代码；未运行官方URL／JS/API，未自动下载任何外部照片。新增组件的DOM专项使用本地URL及解码适配器；尚未执行主线浏览器与真实本地像素验收。

## 本轮核验的官方文件

offset为UTF-8解码后JavaScript字符串的零基字符偏移，非byte offset。

| 文件代号 | 已安装文件 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| A | `/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js` | 919292 | `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694` |
| D | `/Applications/TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js` | 12943515 | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |

交叉参考：[View／照片研究](STUDIO-V3-VIEWS-PHOTOS-20261008.md)、[摄像机接管研究](STUDIO-V3-CAMERA-POSSESSION-20261008.md)。本轮重新读取关键函数，未将旧研究推断当作当前运行验证。

## 原照片集合与保存边界

A `v1` 22081仅提供loadHistoricalPhotos setter，浅复制原集合；初始／reset用空集合。A 55451的actions仅公开`historicalPhotos.load`，未找到append/rename/delete领域命令。

A `Aj` 56262从state.capturedPhotos加载，接受以下item：

```js
{
  id: string,
  src: string, // 非空
  sequence: number, // 类型不是number则0
  width: number,    // 类型不是number则0
  height: number,   // 类型不是number则0
  source: 'camera' | 'possession' | 'panorama_edit' | 'entity_control',
  cameraState, // 原值通过；不是历史照片播放/重渲染请求
}
```

未知source回落camera；没有timestamp、cameraId、setupId、viewId、revision、asset receipt或photo provenance。不能凭sequence排序或构造拍摄时间、地点、镜头名称。兼容gallery `pk` 312918取`src ?? localSrc`，但server Aj仍要求非空src。

A `LS` 56055保存id、四舍五入sequence/width/height、source、src，并在存在cameraState时经`Mj`做camera数值规范化。A `Oj` 57132与`zj` 586xx保存envelope仍含capturedPhotos；A 61666调用`historicalPhotos.load(Aj(K?.capturedPhotos??[]))`。本地schema.mjs332/337同样把capturedPhotos放在state根，与scenePlay平级；读取应为session.getState().capturedPhotos。并非只存在legacy archive中；但本地组件也不实现官方任意存档加载、迁移或重新序列化。

A `w2` 189537当前shutter是capture→exportToCanvas，与historicalPhotos setter独立。相册不会记录本轮新快门、填入新照片或替代画布照片节点。

## 相册真实入口与相邻入口

| 入口 | 源合同 | 位置与边界 |
| --- | --- | --- |
| 历史照片 | A `CE` 856200，items.length>0才显示；按gallery.open切openGallery/close | 底部workspace-viewfinder动作组，图标image20px/1.75；不是顶部设置入口 |
| 相册显示 | A `QW` 320207挂载yk，uiReady且gallery.open | 同historicalPhotos.gallery.items/index/closeRequestId；notice为只读照片说明 |
| 生成历史 | A 384483，availableObjects/historyObjectsRequested/historyObjectsLoading与onRequestHistoryObjects | 添加模型／对象的submenu，使用真实生成对象列表；不读取capturedPhotos |
| 领域撤销／重做 | A `rY` 8574xx中的history.getUndo/RedoAvailability与eY | 独立状态的编辑事务历史，不是图片画廊 |
| 顶部设置 | A `A9` 8387xx | 渲染分辨率、鼠标/触控板、legacy world versions及scene.exports；无历史照片入口 |
| 顶部导出 | A `L9` 843857 | 当前scene全景／方向图／SPZ或GLB下载；不是旧照片下载或历史照片导出 |

### 中文原文

D中文gallery对象91703xx附近：

- 历史照片；查看 {{count}} 张历史照片；新拍摄的照片会直接添加到画布。
- 关闭相册；关闭相册并返回片场。
- 以下历史照片仅供查看。新拍摄的照片会直接添加到画布，不再保存在片场中。

D 9163132：背景关闭按钮为“关闭遮罩”。相册关闭按钮图标实际是`zw→index.gt→BO arrow-left`（D 1191957），应复用已有back资源，不应误用X图标。notice实际是`Bw→index.fd→x_n/Xeo tabler info-circle`（D 4263526），本地从该源几何准确复制；现有warning circle-alert不能替代它。

## inspected gallery UI与生命周期

A `S2` 191498把原数组浅复制后reverse，打开总从index0开始；不按时间或sequence排序。空集合自动关闭，索引越界向内clamp。打开时acquireRenderPauseLease，关闭释放；这是暂停后台render，并非相册自带renderer。

A `yk` 313641是img-based dialog，role=dialog、aria-modal=true，说明note关联aria-describedby。相册主图、右侧缩略图、左上返回按钮、背景关闭；没有作者或导出工具。背景`fk` 312359使用blur32、black .6、300ms过渡。相册overlay层82；header top12/height48/left12。主图maxWidth=100vw−220；原notice模式topPadding=72+64=136，maxHeight=100vh−(136+60)=100vh−196，其中60来自B `un/H` 1638。bottomPadding=max(60,safe-area+72)。主图阴影0 32 80 black .5、white8 border。

缩略图`gk` 3129xx宽160，高round(160×height/width)，尺寸不合法时高76；img object-cover，round6。选中border2 white/opacity1/scale1，未选border1 white12/opacity.55/scale.96，hover white35/.85/scale1。栏gap8，滚动条隐藏，内容不足时居中；栏高度跟当前显示图片并最低76。没有删除序号、拍摄时间或文件名列。

方向键左右／上下做index±1并clamp；Escape关闭。源只明确忽略INPUT/TEXTAREA，未证明IME/contenteditable保证。背景button与返回按钮均关闭，closeRequestId变化也触发关闭；once guard只排160ms退出回调。没有源码可证明focus trap、失败图片fallback/retry或图片下载。

## 本地组件API与实际能力

新增：[photo-history.mjs](../../src/features/studio-v3/photo-history.mjs)、[photo-history.css](../../src/features/studio-v3/photo-history.css)。

```js
const gallery = createPhotoHistory({
  read: () => originalLegacyImages,
  // 可选；缺省使用LocalAssets.url解析asset:或直接读取本地src/localSrc
  resolveImage: async (photo, {signal}) => ({url: actualLocalURL, dispose}),
  // 可选返回函数／{release}，作为render pause lease cleanup
  onOpen: () => acquirePauseLease(),
  onClose: () => closeHistoryOverlay(),
  onError: error => notice(error.message),
});
host.append(gallery.element);
await gallery.ready;
```

返回HTMLElement，其`.element`指自身；附`refresh()`、`dispose()`、`handleEscape()`和当前图片准备Promise `.ready`。read直接返回原照片数组，不返回camera descriptors或generation assets。parent只在capturedPhotos.length>0挂入口，create代表打开，首项为原集合末项。read集合变更后refresh更新，只对src/localSrc/尺寸/sequence改变重新解析；cameraState不触发渲染。

`resolveImage`必须返回已存在的本地图片URL（string或`{url,dispose?}`），不上传／下载／渲染。缺省asset:经宿主LocalAssets.url读取本地资产；外部HTTP原src不会交给LocalAssets.url；若已有实际localSrc，则可使用该本地副本，不修改原照片对象。

assign img.src之前校验data:image、同源loopback HTTP、local file或合法blob URL，拒绝外部地址。resolve adapter返回外部地址同样拒绝。真实native img.decode（缺省load fallback）及naturalWidth/naturalHeight>0后才显示图片，零像素、解码失败或未本地化的旧URL显示真实错误，不回落scene或新图片。此错误反馈、本地URL限制及IME/contenteditable guard是必要本地边界增强，不能称为官方已验证行为。

按主任务明确要求额外补齐modal Tab焦点循环：捕获阶段使Tab/Shift+Tab只在返回按钮和当前缩略图间循环，外部焦点按Tab回到相册。Escape在window捕获阶段关闭并阻止传到后台workspace，局部输入的原有默认行为仍保留。这是本地可访问性／输入边界增强，不属于静态源已证明的focus trap。

异步解析／解码持AbortSignal，数据刷新和dispose取消旧请求；迟到result不会替换当前照片，回收result.dispose；已显示图片在关闭销毁时释放本地URL。onOpen cleanup在关闭或dispose仅执行一次；onClose在160ms退出后仅一次，空集合即关闭；直接dispose不再发送迟到onClose。宿主仍负责实际pause租约和overlay/入口焦点恢复。

组件没有renderCamera/runtime renderer、asset.put、appendCapturedPhotos、views.save、exportToCanvas或任何类似按钮／程序功能。实际图片解码只能证明图片可读取，不能证明迁移、存档保存或新快门管线完整。

## 本轮验证与主线验收

新专项：初9/9通过；后补modal Tab/Escape小回归，新增及相关专项通过，模块语法检查通过。测试覆盖原集合reverse／不变性、比例缩略图、真实本地解析与native decode路径、方向键clamp、once关闭及pause cleanup、空集合、IME/输入隔离、外部URL拒绝、零像素、stale与dispose资源回收，以及Tab循环/Escape不穿透背景捕获。没有重复旧套件。

DOM专项对native decode结果作适配，不能证明GPU／浏览器实际解码像素。本地浏览器仍须验：已有真实LocalAssets照片打开与横竖图切换、加载失败照片诚实错误、方向键/返回/背景/连续close、打开暂停/关闭恢复、workspace/source变更后迟到图片不复活。禁止用远程URL运行官方或自动补下载来通过验收。
