# 音频节点拖动验收

复用当前生产 `index.html`、`app.js` 和 `audio-ui.js`，使用独立项目/素材 IndexedDB。不是官方参考页，不读取普通用户画布，不执行模型生成。

```sh
node scripts/create-audio-player-gesture-main-qa.cjs
```

脚本更新本目录的生产壳，并在忽略的 `build/qa/audio-player-gesture.wav` 生成 3 秒、48kHz、单声道 660Hz WAV。启动本项目服务后打开 `/src/features/audio-playback/qa/gesture-main.html?session=<独立会话名>`，通过「上传本地音频」选择该文件；正式上传会保存 `asset:` 引用。不要在其他项目的同端口服务验收。

1. 节点初始坐标 120 / 160，画布视图平移 160 / 180、缩放 1。拖播放器顶部空白 120 / 50 屏幕像素，节点应为 240 / 210，播放位置仍为零。
2. 一次撤销回 120 / 160，一次重做回 240 / 210；不要让焦点留在标题输入框中。
3. 拖动波形到后段，只改变播放位置。播放/暂停、前进/后退 10 秒不移动节点。
4. 按钮之间的空白仍能拖动；撤销这一笔，刷新后应恢复 240 / 210，音频完整解码，文本节点保持 580 / 160。

源码与实际 CUA 的边界见 [专项记录](../../../../docs/AUDIO-PLAYER-GESTURES-20261008.md)。
