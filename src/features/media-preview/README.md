# 媒体预览来源

`provenance.mjs` 保存真实图片/视频结果的任务、请求模型、提示词和媒体地址。共享预览沿用现有“模型”字段；不新增图标或凭缺省生成参数推测媒体来源。

- `generation-result`：应用真实任务输出时捕获 `output.model` 或原请求的 `parameters.model/modelId`，绑定实际存储的媒体地址。编辑下一次生成参数不改变已有媒体的显示模型。
- `video-analysis`：原生 `video.analyze` 及带 `sourceRange` 的物理裁片。视觉模型负责描述，不能显示为视频生成模型。
- `studio-render`、导入文件和其他无可验证生成模型的本地结果：省略“模型”。没有来源元数据的旧独立节点也省略，不借用编辑器默认值。
- 历史批次可使用对应批次/单个结果保存的模型；`previous:*` 和从当前节点配置派生的 `legacy` 批次不能把下一次请求参数当作原媒体的生成模型。

普通生成、派生结果、历史及恢复结果在现有应用链保存元数据。切换主版本时恢复该版本的来源；媒体地址被替换后，不再使用旧地址绑定的模型。`asset:` 本地素材在已经本地化之后取实际字段绑定。当前生成应用链仅本地化音频，图片/视频地址原样写入画布与 IndexedDB。

图片擦除、重绘、扩图、增强/皮肤和抠图的自定义回填使用 `../image-editor/generated-results.mjs`，保留 `runInPlace` 已绑定的原任务、模型、提示词和全尺寸媒体地址；每个版本独立保存来源，缩略图地址不能替代全尺寸来源地址。多角度和打光沿用共享图片历史。旧版本切换使用该版本保存的来源，增强前的导入图片不借用节点下一次生成设置；无来源的本地编辑也不补造生成记录。

聚焦验证：

```sh
node --test tests/media-preview.test.cjs tests/video-history.test.cjs tests/image-history.test.cjs tests/generation-results-workflow.test.cjs tests/generation-application.test.cjs tests/generation-recovery-integration.test.cjs
node --test tests/image-edit-provenance.test.cjs tests/image-versions.test.cjs
```

这些回归验证应用与来源显示规则；不证明真实供应商质量或官方全站视觉一致。缺少来源的历史独立媒体不会补造模型记录。
