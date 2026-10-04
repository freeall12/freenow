const entries = [
  {group:'基础交互',name:'操作菜单',kind:'可直接复用',entry:'component-library/ui.js',api:'ReplicaUI.createMenu({ element, label, onError })',files:['canvas-menus.js','canvas-menus.css'],detail:'支持分隔、禁用、快捷键、键盘移动与焦点恢复。画布右键菜单已经使用。'},
  {group:'基础交互',name:'悬浮提示',kind:'可直接复用',entry:'component-library/ui.js',api:'ReplicaUI.createTooltip({ root, selector, delay, canShow, place })',files:['component-library/ui.css'],detail:'委托事件、键盘焦点、视口约束与销毁生命周期。画布工具栏已经使用。'},
  {group:'基础交互',name:'功能模块入口',kind:'需画布宿主',entry:'component-library/features.mjs',api:'openImageTool / openVideoTool / openMediaPreview',files:['component-library/README.md'],detail:'统一的动态加载入口；检查当前节点与画布宿主后再打开原实现。'},
  {group:'画布与组织',name:'坐标与导航',kind:'逻辑模块',entry:'component-library/core.cjs',api:'geometry / navigation',files:['canvas-geometry.js','canvas-navigation.js'],detail:'世界坐标、适屏、空视口与平滑移镜计算。'},
  {group:'画布与组织',name:'节点搜索',kind:'需画布宿主',entry:'src/features/canvas-search/ui.js',api:'CanvasSearchUI.open() / core.search',files:['src/features/canvas-search/core.js','src/features/canvas-search/styles.css'],detail:'标题、Prompt、正文索引及分类搜索；界面需要 CanvasApp。'},
  {group:'画布与组织',name:'节点分组',kind:'需画布宿主',entry:'canvas-groups-ui.js',api:'CanvasGroups / CanvasGroupsUI',files:['canvas-groups.js','canvas-groups.css'],detail:'分组关系、布局与八向缩放。'},
  {group:'画布与组织',name:'堆叠画廊',kind:'需画布宿主',entry:'canvas-piles-ui.js',api:'CanvasPilesUI.open(id)',files:['canvas-piles.js','canvas-pile-motion.js','canvas-piles.css'],detail:'成员关系、打开过渡、画廊与下载。'},
  {group:'画布与组织',name:'工作流与模板',kind:'逻辑模块',entry:'component-library/core.cjs',api:'workflow / templates',files:['workflow-core.js','templates-core.js','workflow-ui.js','templates-ui.js'],detail:'依赖调度、模板捕获与实例化；UI 需要画布状态。'},
  {group:'媒体',name:'媒体预览',kind:'需画布宿主',entry:'media-preview-ui.mjs',api:'MediaPreview.open(node)',files:['media-preview-core.mjs','media-preview.css'],detail:'图片、视频、历史、提示词与播放控制；预览逻辑通过 media.mjs 导出。'},
  {group:'媒体',name:'剪辑时间线',kind:'需画布宿主',entry:'canvas-playlist-ui.js',api:'CanvasPlaylist.open(id) / core.playlist',files:['canvas-playlist.js','canvas-playlist.css'],detail:'排序、切割、裁剪与预览；媒体导出依赖本地服务。'},
  {group:'媒体',name:'音频播放器与生成',kind:'需画布宿主',entry:'audio-ui.js',api:'AudioAPI / core.audio',files:['audio-core.js','audio.css'],detail:'波形、播放与模型参数；生成需外部服务适配器。'},
  {group:'图片编辑',name:'图片编辑器',kind:'需画布宿主',entry:'image-editor-entry.mjs',api:'CanvasImageEditor',files:['image-editor-core.mjs','image-editor.css'],detail:'Fabric 编辑、图层、文字、裁剪与导出。先构建 assets/image-editor.js。'},
  {group:'图片编辑',name:'裁剪与缩放',kind:'逻辑模块',entry:'component-library/media.mjs',api:'imageCrop / imageResize',files:['image-crop-ui.mjs','image-resize-ui.mjs'],detail:'纯计算可独立使用；交互层需要 CanvasApp 与节点上下文。'},
  {group:'图片编辑',name:'角度、历史与版本',kind:'逻辑模块',entry:'component-library/media.mjs',api:'imageAngle / imageHistory',files:['image-angle-ui.mjs','image-history-ui.mjs','image-versions-ui.mjs'],detail:'参数与历史算法可独立使用；界面挂载在画布节点。'},
  {group:'图片编辑',name:'增强与重新打光',kind:'需画布宿主',entry:'image-enhance-ui.mjs',api:'ImageEnhance / ImageRelight',files:['image-enhance-core.mjs','image-relight-ui.mjs','image-relight-core.mjs'],detail:'增强参数、真实光源预览与结果回填；生成请求需要服务适配器。'},
  {group:'图片编辑',name:'抠图、擦除与重绘',kind:'需画布宿主',entry:'image-cutout-ui.mjs',api:'ImageCutout / ImageErase / ImageRedraw',files:['image-erase-ui.mjs','image-redraw-ui.mjs','image-erase-core.mjs'],detail:'图片来源、蒙版和提交入口；模型处理需要服务适配器。'},
  {group:'图片编辑',name:'扩图与标注',kind:'需画布宿主',entry:'image-outpaint-ui.mjs',api:'ImageOutpaint / ImageAnnotation',files:['image-annotation-ui.mjs','image-outpaint-core.mjs'],detail:'扩图外框、区域选择、文字和对象标注；依赖节点与图片编辑状态。'},
  {group:'视频编辑',name:'视频裁切与延长',kind:'逻辑模块',entry:'component-library/media.mjs',api:'videoTrim / videoCreation',files:['src/features/video-trim/ui.mjs','src/features/video-creation/ui.mjs'],detail:'裁切区间和延长请求参数可复用；真实生成需服务适配器。'},
  {group:'视频编辑',name:'视频历史',kind:'逻辑模块',entry:'component-library/media.mjs',api:'videoHistory',files:['src/features/video-history/ui.mjs','src/features/video-history/styles.css'],detail:'批次与版本状态；界面需要节点存储。'},
  {group:'视频编辑',name:'视频重拍与蒙层',kind:'需画布宿主',entry:'src/features/video-reshoot/ui.mjs',api:'reshoot.open(node) / mask.open(node, mode)',files:['src/features/video-mask/ui.mjs','src/features/video-reshoot/core.mjs','src/features/video-mask/core.mjs'],detail:'分镜机位、蒙层、替换与移除状态；结果服务需要单独配置。'},
  {group:'视频编辑',name:'视频增强与截帧',kind:'需画布宿主',entry:'src/features/video-upscale/ui.mjs',api:'upscale.sync() / VideoAnalysis.analyze()',files:['src/features/video-upscale/core.mjs','src/features/video-capture/core.mjs','src/features/video-analysis/ui.mjs'],detail:'增强参数、真实抽帧和分析入口；模型增强与分析依赖服务适配器。'},
  {group:'片场与助手',name:'3D 片场',kind:'需画布宿主',entry:'studio.mjs',api:'StudioAPI.open(id)',files:['studio-state.js','studio-camera.js','studio.css'],detail:'Three.js 场景、镜头、环境、放置与时间轴，需要 WebGL 和画布节点。'},
  {group:'片场与助手',name:'Agent 面板',kind:'需画布宿主',entry:'agent-client.js',api:'AgentUI.open() / AgentUI.execute()',files:['agent-tools.js','agent.css','server/agent.cjs'],detail:'对话和工具执行依赖本地服务与权限确认。'}
];

export default entries;
