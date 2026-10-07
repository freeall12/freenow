# 摄像机接管 HUD 模块合同（2026-10-08）

```js
const hud = createCameraControlHUD({
  read: () => runtime.possessing?.camera,
  getBusy: () => captureBusy,
  getPendingCapture: () => !!cameraCapture.pendingReceipt,
  apply: patch => runtime.patchCameraControl(patch),
  capture: async () => captureCurrentFrame(),
  cancel: () => runtime.cancelCameraControl(),
  finish: () => runtime.finishCameraControl(),
  onError: error => notice(error.message, true),
  toggleFocusPicking, // 可选，同步boolean，真实场景拾取由宿主负责
  getFocusPicking: () => picking,
  getDepthOfFieldSupported: () => runtime.depthOfFieldSupported,
});
```

返回 HTMLElement，附 `refresh()`/`dispose()`。宿主在 possession 与 capture busy 变化时 refresh；`read` 无相机才隐藏，不凭动作成功自行假退出。隐藏后迟到的控件点击不调用宿主拍摄／退出／选点。apply/cancel/finish须返回同步 true；capture接受 Promise<boolean|{ok:boolean,message?}>，只有true/ok:true算成功。失败保留 HUD 并以alert和onError报告。getBusy或拍摄进行中禁用光学、拾取、拍摄和退出动作，阻止拍摄期间修改scope。

`getPendingCapture` 可选getter，缺省false；真实保存失败后宿主仍持有receipt时传true。此时禁用画幅、焦距、光圈、对焦、还原与完成，并拦截本地Escape；快门仍可用，title/aria变为“重试保存照片”，调用同一capture由宿主幂等恢复。外部busy或重试进行中连快门一起禁用。receipt与忙碌都清除后恢复控件；HUD不自行丢弃receipt或释放lease。失败feedback保留宿主error.message原文。宿主必须同时阻止camera navigation、关闭与scope切换。

顺序与原图标按官方wY/Xl/IE：画幅→separator→焦距尺→光圈尺→对焦→separator→快门→separator→还原并退出→完成。ratio动态SVG使用官方Ln原始矩形计算，chevron复用现有chevronRight旋转；focus、undo-2、check均取icons.mjs原资源，尺寸及stroke匹配安装包。快门为原vc的20px border2圆环和12px中心；另导出 `createCameraShutter(action)`，自动加载相同CSS供preview/create-viewfinder复用。

来源：[摄像机接管研究](research/STUDIO-V3-CAMERA-POSSESSION-20261008.md)，以及安装包ThreeDWorkspace-BzPphAqB.js的wY/ih/IE、WorkspaceViewfinderButton-BHqIWibq.js的Xl/mc/gc/$l/zt。焦距log范围8–400、534px轨；光圈1.4–22、216px轨，加18px泛焦terminal；原预设、窗口132/124、40px高度、2×8主要刻度、5px次要刻度、12px指示线、约6px间距均保持。底部fixed-major预设在轨上等间距，值映射使用原log公式；不误用所有预设位置等同log位置。

pointer capture且超过3px才进入drag；拖动刻度带即时apply预览；pointerup结束局部交互，不finish possession。Xl实际未传interactionCancel，故pointercancel/lostcapture/局部Escape按zt fallback保留已接受预览并结束局部交互。全局“还原并退出”才调用cancel。非drag刻度位移按exp(-28dt)回弹，.25px收敛；穿越中心的tick高亮按340ms cubic衰减。RAF只在有实际位移／高亮时存在；pose-only或相同光学值refresh不会申请空RAF或遍历全部tick。dispose中断动效与本地监听，不修改宿主camera。

画幅菜单是两组19项、五列、56px按钮与maxHeight360。拾取对焦只切换真实host picker，不替换为数值弹窗；未提供toggle回调时禁用。Escape优先结束picker，再局部slider/menu，最后finish。HUD根带官方 `data-world-workspace-block-movement-hotkeys="true"`，使真实camera navigation在window捕获阶段识别并跳过本地控件。仅在冒泡阶段stopPropagation不够：会导致尺上ArrowRight被提前消费并旋转相机。HUD不操纵全局场景输入，宿主仍须为其他场景输入处理器保留相同scope边界。

`getDepthOfFieldSupported` 可选getter，缺省true；主线须传真实渲染能力。false时隐藏并禁用光圈与对焦，保留ratio/focal和快门；普通GLB片场不能靠参数存在宣称景深虚化已实现。真实Spark profile才显示完整DOF工具。拾取后derived轴向对焦距离由宿主read.camera提供，本模块只显示，不伪造距离。

19项测试覆盖原几何与顺序、log映射、真实光学patch联动、pointer阈值/取消/Escape、ratio分组、picker与局部Escape刷新、隐藏后的迟到操作、拍摄busy/失败、拒绝结果、IME隔离、动效收敛与无空RAF、独立shutter样式加载及DOF能力切换。保存恢复测试覆盖pendingReceipt对镜头/lease的冻结、重试快门、原文错误、busy fence与宿主清除receipt后的解锁。新增标记与真实导航DOM事件测试验证window捕获阶段跳过HUD，使ArrowRight改焦距且保留pose，画布方向键仍正常转相机。DOM与纯光学测试不替代真实浏览器视觉和拍摄入画布验收。
