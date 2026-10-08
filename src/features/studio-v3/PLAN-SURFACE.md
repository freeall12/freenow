# Plan 摆位与轨迹表层合同

`src/features/studio-v3/plan-view.mjs` 仅负责屏幕呈现和指针事务，实体、时间轨迹、历史、支撑面和菜单由 host 提供。依据 `docs/research/STUDIO-V3-PLAN-20261008.md`，官方 `WorkspacePlanView-HeQ7o6cq.js` 的 hr/fr/wr/zt 与 `ThreeDWorkspace-BzPphAqB.js` 的 k4/w4。

## 摆位

- `getPlacement()` 返回 pending 描述符 `{kind:'actor'|'camera',id?,roleId?,label?}` 或 null。
- `beginPlacement({point:{x,y,z},projection,clientX,clientY,event})` 返回异步 lease `{onMove,onEnd,onCancel}`。point/projection 来自最近成功显示帧；领域自行找支撑面，不把现有实体拖动变为落地。
- 表层 capture pointerdown 在 marker/path/pan 前消费摆位。起点固定，move 只交 `{heading}`，距起点小于 .05m 不改朝向；点击也执行 onEnd。actor/camera 的官方 instruction 按描述符显示。
- Escape 有 pending 时调用 `onCancelPlacement()` 并留在俯视图；手势取消还回滚 lease。source/setup/revision/readiness、pending 描述符变化、pointercancel、blur、dispose 都禁止迟到 lease 预览或提交。

## 轨迹数据与操作

`getPaths()` 返回领域快照，vec3 均为 `{x,y,z}`：

```js
{
  id, entityId, kind: 'person' | 'object' | 'camera', color, selected,
  visible, locked, readOnly, hovered, rhythmVisible, opacity, dashed,
  keys: [{id, keyId, timeMs, position, selected, heading, camera}],
  segments: [{id, fromKeyId, toKeyId, fromTimeMs, toTimeMs,
    interpolation: 'cubic' | 'hold', p0, p1, p2, p3,
    points: [vec3], parameters: [number]}],
  controls: [{id, kind: 'bend' | 'endpoint', position, anchor,
    fromKeyId, toKeyId, endpoint: 'start' | 'end', t,
    screenProxy: {anchors: [vec3], fallbackPoint: vec3}}],
  playhead: {position, timeMs, heading}
}
```

points 是等时间采样的真实轨迹，包含 bend 约束后的曲线；parameters 与 points 同索引，用于将最近屏幕样本插值回真正 cubic t。展示有 samples 时画 polyline，否则画 p0..p3 cubic；hold 不连接两端，按官方暂停符号显示。selected/hovered/rhythmVisible 控制 hold/playhead 节奏显示。

`beginPathEdit({kind:'key'|'key-heading'|'key-fov'|'bend'|'endpoint'|'path',pathId,entityId,keyId?,fromKeyId?,toKeyId?,endpoint?,t?,timeMs?,position})` 返回同样异步 lease；`onMove({position})` 保留 key/control 原 Y。>=4px 才打开事务，初始指针与真实控制点的屏幕偏移保留，30px proxy 被拖时不会跳回 anchor。曲线 drag 冻结 pointerdown 的 segment 与 cubic t，领域按 bend 合同处理；**曲线 click 不创建 key**，hold 或接近端点的拒绝由领域判定。

trajectory key 使用与 live marker 相同的官方 er/tr/ir glyph、selected direction 和 camera FOV，锚点、heading、camera optics 均来自该 key 的 sampled 描述符。key-heading 拖中 `onMove({heading})`，结束 `onEnd({heading})`；key-fov 拖中仅局部 RAF preview 与角度/焦距 readout，结束 `onEnd({heading,fov})`，由领域先预览最终值再提交一次。FOV 保留另一侧 ray、按 key.frameAspectRatio 转换与 clamp；不读取 live camera optics。key 的 selection/存在性变化使 heading/FOV lease 取消；local RAF 在 pointerup/cancel/blur/dispose 清理。

`onPathSelect({pathId,keyId?,clientX,clientY,event})` 用于首次 key 点按、曲线点按及路径/实体选择；曲线 t<=.001/>=.999 点按选择两端 key。已 selected key 的再次点按调用 `onPathContextMenu({pathId,entityId,kind:'key',keyId,clientX,clientY,event})`。key 右键同样打开领域菜单；bend 右键带 fromKeyId/toKeyId，供 host reset；endpoint 右键消费后不发菜单。drag trailing click 被隔离，不重复选择。

## 渲染、命中与边界

稳定 SVG 层按 path10、marker、control35、live FOV40、key45 排列，key 内 FOV/方向同属45。轨迹节点不按帧 replaceChildren/reinsert；pointer 手势期间 marker 也不重新排序。原 camera FOV 视觉和处理保留，单独的透明 FOV 命中层保证优先于 path control。

path hit stroke 至少26px，control hit r18，proxy 距最近 anchor 至少30px并显示 connector。marker/key 使用官方几何。命中反解只使用最后成功显示 projection；无 ready/projection 或零 viewport 时拒绝。author fence 或 lease 失败调用取消，取消失败保留事务供 Escape 重试。表层不加载资源、不做支撑面 raycast、不写历史或创建菜单内容。

聚焦验证：`node --test tests/studio-v3-plan-view.test.cjs tests/studio-v3-plan-placement-trajectories-focused.test.cjs`。该验证覆盖指针/事务与 SVG 合同，不能替代真实浏览器视觉和领域集成验收。
