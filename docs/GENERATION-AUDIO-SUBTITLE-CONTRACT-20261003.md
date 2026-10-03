# 音频结果的可选真实字幕

现有 `outputs` 数组保持原样。供应商可以在明确对应的音频项上返回可选字幕：

```json
{
  "status": "succeeded",
  "outputs": [
    {
      "type": "audio",
      "url": "/api/generation/media/528237bf-670a-462b-ae7c-d3301d39076e",
      "subtitle": {"text": "供应商实际返回的第一行\n第二行"}
    }
  ]
}
```

公开 URL 仍须由本地媒体仓库产生。字幕是有界文本元数据，不增加下载资源、字幕 URL 或新的供应商请求。它不是一条独立 `type:text` 输出，也不是节点修改指令。

`subtitle` 若存在，必须是仅有 `text` 字段的普通对象；`text` 必须为字符串，UTF-8最多32KiB。保留原换行、回车、制表符及首尾排版，不对实际字幕内容trim改写；只用trim判断是否为空。合法空字符串或纯空白视为未提供字幕，省略该字段，音频照常完成。拒绝NUL/其他非排版控制字符、损坏的孤立UTF-16 surrogate、额外字段、URL/segments/speaker结构及非audio项上的字幕。没有返回字幕则省略该字段，音频仍照常完成；明确返回错误形状则回执校验失败，不静默截断。

多个音频输出必须各自携带明确对应的字幕。后端不把任务级字幕复制给多个音频，不把普通文本结果或prompt转换成字幕，不提供原站协议adapter，也不猜测legacy envelope。

## 本地化与恢复

`server/generation-audio-subtitle.cjs` 统一验证和复制 `{text}`。durable 的 `checkedOutputMetadata`、本地素材 materializer 的 `describe` 和公开结果白名单使用该合同：供应商原输出、已保存本机输出及GET/按幂等键恢复均保留真实字幕。依然先等待音频实际落盘和资源完整性核验才公开成功。

恢复沿用原任务、供应商身份、提交幂等键和原请求；已就绪的音频与字幕可跨重启直接取回，不再POST生成。下载授权、Key和原媒体URL不因字幕字段进入公开回执。字幕文本不写媒体文件manifest；它保存在私有任务结果并作为明确允许的公开文本元数据返回。

## 前端应用边界

字幕元数据的存在本身不授权修改文本节点。前端只能在原已接受请求的Seed音频模型及 `parameters.enable_subtitle === true` 条件满足时，按实际音频结果节点绑定创建/更新字幕文本；刷新、历史恢复和重试必须保留原请求及同一音频结果身份。`sourceAudioNodeId` 是前端绑定字段，不属于供应商字幕结构，后端不接受字幕携带该修改指令。

原生OpenAI Speech仍不支持 `enable_subtitle:true`，此合同不改变其参数支持范围，也不生成假字幕。真实Seed接口联调及字幕入图由前端单独验收；本次服务端测试仅用显式供应商fixture。

## 验证

```bash
node --test tests/generation-audio-subtitle.test.cjs
```

5项定向测试验证严格形状及UTF-8边界、换行保留、无prompt/普通text推导、非audio污染拒绝、per-audio元数据不增加媒体资源，以及真实WAV本地落盘→公开回执→私有任务保存→跨重启按幂等键GET恢复。恢复测试保持同一音频ref、原任务ID和原请求模型/开关，供应商POST总数始终为1。

空字幕专项可单独运行 `node --test --test-name-pattern="empty and whitespace subtitles" tests/generation-audio-subtitle.test.cjs`，覆盖validator、公开结果白名单与materializer均省略空字幕，且保留有效字幕原排版和其余严格拒绝边界。
