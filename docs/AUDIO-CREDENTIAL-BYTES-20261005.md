# 原生音频凭据字节检查 · 2026-10-05

独立复核 ElevenLabs Music 时，以有效 ID3v2.3 TXXX UTF-16 文本标签携带合成服务端 Key，再拼接现有 MP3 tone fixture。原实现只扫描 `bytes.toString('utf8')`，会将该结果标为成功并返回 data URL，解码后仍包含 Key。旧 ElevenLabs TTS、Sound 和 MiniMax Music 的 decoded audio 也使用相同 UTF-8 检查边界。

这不是真实供应商泄露证据；所有复现仅使用合成 Key、本地 fixture 和独立模拟响应，没有读取真实凭据或调用计费接口。

## 修复边界

- `server/outbound-client.cjs` 新增 `assertCredentialFreeBytes(bytes,secret)`。复用既有 UTF-8、原文/百分号编码回显检查；再按文件 offset 0/1 分别检查 UTF-16LE 与 UTF-16BE 文本视图。文本可以处在任何字节偏移，不依赖 ID3 标签与文件头对齐。
- `server/generation-elevenlabs.cjs`、`server/generation-elevenlabs-sound.cjs`、`server/generation-minimax-music.cjs` 在返回 data URL 前使用公共检查。MiniMax 检查的是 HEX 响应解码后的真实音频 bytes，仍保留 JSON 响应扫描。
- 新 ElevenLabs Music 的独占 owner 同时改为调用公共检查，移除了其临时局部 guard。

检查返回原 bytes，不删除标签、不转码、不改变采样率或歌词请求。凭据拒绝仍被各 adapter 转为既有 `unknown`，不重试 POST，不向公开错误暴露 Key。函数不承担 MP3/WAV 格式解析，现有完整帧、码率、采样率与长度校验保持原样。

## 定向回归

`tests/generation-audio-credential-bytes.test.cjs` 构造有效 ID3v2.3 TXXX 标签，覆盖 UTF-16LE/BE × 原文/混合大小写百分号编码 × 两种字节对齐，共 8 个变体。使用有效奇数长度 PRIV frame 改变对齐，不靠破损标签绕过格式校验。

四个原生 adapter 均验证：标签回显后只有一次 POST、结果为 unknown、无公开 outputs；正常 MP3 完整 bytes 保持。每个 adapter 另接生产 durable service、media store、materializer，确认回显结果无私有 providerResult、无音频 `.bin` 归档；关闭重启、同幂等 Key 再提交仍是原 unknown，没有第二次 POST。

```bash
node --test tests/generation-audio-credential-bytes.test.cjs tests/generation-elevenlabs.test.cjs tests/generation-elevenlabs-sound.test.cjs tests/generation-minimax-music.test.cjs tests/generation-elevenlabs-music.test.cjs
```

结果：**56 passed，0 failed**；改动 CJS 的 `node --check` 和 scoped `git diff --check` 通过。初次新用例用紧密的 `setImmediate` 等待磁盘任务状态，时间预算不足；改为现有测试采用的有界 5ms 等待后通过，未修改生产调度或放宽断言。

这是定向音频和共享 guard 检查，未运行全库 suite、未操作主线程浏览器。MP3 包络及完整字节验证不等于实际声音内容或歌词效果评测；真实账号权限、Music v1 成曲效果与供应商字段遵循仍未验。

本检查覆盖指定文本编码的 Key 回显，不将任意二进制转换、声音表达或媒体内容审查纳入凭据扫描合同。
