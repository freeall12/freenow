# Camera Shot Sampling

`camera-shot-sampling.mjs` 提供动态镜头导出的同步纯采样函数：

```js
import {sampleCameraShotState} from './camera-shot-sampling.mjs';
const {state: renderSnapshot, camera} = sampleCameraShotState(authorState, shot, timeMs);
// 把 renderSnapshot 与 camera 传给独立 photographic renderer。
```

## 输入、输出与边界

输入为现有严格 schemaVersion 4 完整状态、至少含 `stageId/setupId/cameraEntityId` 的镜头描述符、有限 timeMs。目标须为独立 setup，stage 一致，camera 必须有同 stage 的真实摄像机定义和有效 setup state。时间按官方 km 取 max(0,round(timeMs))。无链接 View 的静态图片应使用其独立 still 路径；本接口采用官方视频 mK 的 strictTemporalCamera 行为，不能合成 camera 实体或取其他镜头代替。

返回 `{state,camera}` 两个互相独立的深复制对象。state 是完整临时渲染快照，active stage/setup 对应 shot，activeViewId=null；目标 setup 的 local entityStates 是该时刻结果。保留 temporal tracks、baseline、其他 setup、时间戳、Views、outputs 与其他持久字段。`renderSetup(state)` 仍保留基准实体优先，没有在独立 setup 中追加共享实体覆盖。

函数不改作者状态、live viewport、history、playhead、资产集合或文件；不调用 provider/API/GPU/编码器，不保存。异常通过现有 `StudioDomainError` 抛出。缺失关系、cross-stage、不支持字段／插值、非法 schema、NaN/Infinity、采样后非法光学值拒绝，不返回占位结果。日志由宿主决定。

## 已证实的采样合同

官方证据为安装包 `/Applications/TapNow.app/Contents/Resources/web/assets/course-api-base-url-CGXqZmAy.js`，UTF-8 JS string 零基字符 offset，SHA-256 `157e386a92b4f5fa4b3b6111c41c178e160ca3025947fe63858d044ab6e593ca`。本模块依赖项目已有 Three，只用纯 Euler/Quaternion 数学；未执行官方 JS。

| 行为 | 官方源码依据 |
| --- | --- |
| 同stage baseline实体优先，独立setup只追加未在baseline出现的实体，保持目标setup id与temporal | dOe1527746、gdt1527957；现有renderSetup复用此合同 |
| 已用 channel keys 按时间/ID排序，首 key 前返回 null（保留 base），首末精确命中，最后 key 后保持；区间以左 key interpolation 决定 | EF1558046、SF1553754 |
| scalar线性、普通vec3分量线性、离散字段保持左 key 到下个精确 key | nY1558211 |
| Euler转quat，负dot取反，dot>.9995 normalized lerp，否则 shortest slerp；结果回首 key Euler order | UOe1541577、WOe1542270、Gq1542733 |
| position专用曲线，首末 key前后规则同上，hold直到下一精确 key | wLe1553133、lLe1548003、Yq1548425 |
| 邻接切线：端点使用相邻差；内部(next−previous)/2；p1=start+tangent/3，p2=end−tangent/3；首／末可显式endpoint control替换 | eLe1544950、tLe1545518、nLe1545950 |
| spatialBend在bend.t施加point−Bezier(bend.t)校正，分段smoothstep权重；t限制.05–.95 | hLe1549915、pLe1550071、CF1551006 |
| 非直线轨迹64等参数弦段累计3D弧长，时间比例经累计距离逆查为Bezier参数；直线检测每分量epsilon1e-10；退化length<=1e-8用原time比例 | cLe1548661、Xq1549281、nb1550152 |
| camera.rotation channel存在有效值时忽略entity.transform.rotation channel；实体位置同步camera位置，两类rotation使用已有heading反射转换保持plan/camera一致 | kLe1559328、TLe1556349；transform-coordinates.mjs已有实证合同 |
| fov与focal按keys合并，同key focal优先；fov转焦距使用该key时刻ratio；焦距插值a*(b/a)^t；ratio等普通channels先应用，focal最后按当前ratio更新fov | SLe1554494、ELe1555151、zOe1541053、TLe1556349 |

位置“linear”并非把三个以上的点逐段直连。它使用上述平滑路径和距离时间；hold不走曲线。endpoint和bend是实际几何约束，不是ease类型。姿态不能直接线性插值Euler，fov也不能直接线性插值角度替代焦距。

覆盖严格 schema 已知字段：entity position/rotation/scale/visibility/pose/lookTarget/heldEntityId；camera rotation/fov/focalLength/frameAspectRatio/focus/focusDistance/apertureFNumber/depthOfFieldMode/lookAt。heldEntityId=null 删除字段。focus/lookAt目标保持领域值，不在采样阶段解析对象位置或改为rotation；渲染器负责正确呈现这些目标。actor pose的骨骼／clip播放、held关系、lookTarget效果也属于渲染器执行合同，采样返回这些字段不证明渲染器已经支持。

## 明确差异与未支持范围

- 只接受本地严格展开 schema；未知字段、官方紧凑序列化、legacy `camera.position` channel alias、重复／未排序 keys、future interpolation 不做容错映射。官方 Ex/kLe会规范化一些输入，本模块沿用项目严格拒绝策略。
- 官方 zOe在非正 focal 插值时保持旧值；本地严格输出与光学校验拒绝非法值，避免编码成功但含非法镜头。有限边界值通过 schema，不偷偷clamp到HUD presets。
- 只生成当前帧 detached state；不自动写入或清除LookAt，不创建关键帧，不用于作者编辑提交。输出继承基准优先，基准没有temporal；现有schema要求track owner属于local独立状态。
- 采样本身不证明独立渲染、真实视频编码、浏览器codec可用、导出持久保存或完整actor动画。宿主必须对其renderer无法呈现的受影响字段显式拒绝，不能把采样成功当作视频验收。

## 验证

```bash
node --test tests/studio-v3-camera-shot-sampling.test.cjs
```

13个专项使用真实schema/world-space，覆盖baseline合并、inactive setup、深复制与不可变、首key前base/时间round/末端clamp、hold精确边界、endpoint曲线/弧长时间、内部切线、spatialbend、yaw wrap与rotation channel优先、plan-camera转换、fov/focal合并与几何插值、keyratio、全部光学和entity离散字段、非法数据与无链接拒绝。没有运行官方JS或依赖外部API；真实离屏renderer与编码由导出模块另行验收。
