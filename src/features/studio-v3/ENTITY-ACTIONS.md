# V3 实体动作合同

`entity-actions.mjs`是内部纯领域适配，不接入UI、renderer、持久化或供应商。它只使用schemaVersion 4的role/entity/setup state；没有`objects`旧数组映射。运行时仍须检查当前项目/会话、readonly、播放与输入租约，并等待真实保存完成。

```js
import {resolveEntityControl, reduceEntityAction} from './entity-actions.mjs';

const actor = reduceEntityAction(state, {
  type: 'create', kind: 'actor', id: 'entity:actor-1', roleId: 'role:actor-1',
  label: '林岚', transform: {position: {x: 2, z: -1}}
}, {now: 1000});
// actor = {ok:true,state,entityId,roleId,lane:'world',scope:{kind:'world-space'},changed:true}
history.transact(actor.lane, '添加人物', () => actor.state, actor.scope);

const control = resolveEntityControl(actor.state, {entityId: actor.entityId});
// Detached definition/setupState, ownerSetupId, baselineReadOnly, locked,
// animated (all setups), canToggleLock, lockDisabled,
// definitionLane:'world', stateLane:'world' | 'setup:<setupId>'.
```

`setupId`省略时使用activeSetupId；`now`默认Date.now，调用方可明确传入事务时间。新实体ID由宿主分配，模块不生成随机ID。所有非法schema/字段/重复ID/跨stage/无效来源均抛StudioDomainError；正常只读或锁定拒绝返回`ok:false`，state保持原身份，便于UI保留原状态并显示message。

| type | 输入 | 修改与建议lane |
| --- | --- | --- |
| create actor | `id`与不同的`roleId`，可选label/actorGender/color/transform/visible/pose/locked | 新独立role及实体实例；默认实际`/assets/studio/character.glb`、neutral/Standing；world |
| create actor复用角色 | `id,existingRoleId`；可选实例label/transform/visible/pose/locked | 复用同stage角色及其外观，禁止再传roleId/actorGender/color；world |
| create camera | `id`；可选label/color/transform/visible/camera | 实际`/assets/studio/camera.glb`；V3 camera position/rotation与共用camera-optics合同；不提供Lock；world |
| create prop | `id,assetId`；可选label/color/transform/visible/locked | 精确查studioLibrary，sourceUrl/sourceFormat/presentationAnchor，原目录scale进入transform；world |
| update | `entityId,patch` | label/color/locked/materialMode写definition并建议world；transform/visible/pose/camera/lookTarget/heldEntityId/path写所属setup state，独立状态建议setup lane、基准建议world；混合补丁建议world |
| restore-placement | `entityId`，可选setupId；无camera state时可提供真实fallbackCamera | actor/prop恢复identity；camera恢复位置(0,1.6,0)、零旋转与scale1，保留现有optics；独立setup lane或基准world；不是落地操作 |
| remove | `entityId,mode:'local'|'global'` | local先解析ownerSetupId：自己的独立实例走局部删除，继承基准实例走基准全局级联；其他setup/view仍使用定义则保留定义、建议setup lane；最后实例按现有world reducer清理定义与关系，结果removal变global、建议world。global显式级联，建议world |
| clone | `entityId,newId`；可选label/transform | 新实体ID，复制原实例状态、asset与roleId；保留角色关联，不创建新role，不复制tracks/key IDs；world |

transform接受部分xyz及rotation order；位置/旋转为V3数值对象和弧度，禁止旧position数组、name、animationIndex等。camera pose与transform pose双向同步；同一动作传入不一致的双份pose拒绝。仅编辑camera optics时保留原有光学pose，避免改变合法既有镜头位置。

`resolveEntityControl`先取stage基准state，再取独立state，返回拷贝。独立setup中基准实体的transform/visible/pose及restore-placement返回`baseline-readonly`、`suggestedSetupId`指向该stage基准、中文切基准提示；不新建覆盖state。definition重命名、颜色、actor/prop锁定可正常world编辑。删除单独遵守原wy→m1→Qc的owner路由：请求local删除继承基准实体时按ownerSetupId全局移除，不把它写为独立隐藏状态；结果明确removal=global、lane=world。clone基准实体时可在当前独立setup创建不同ID的本地实例，原基准不变。当前setup没有实例时状态动作返回`entity-not-in-setup`，不凭空添加override。

Lock仅actor/prop；camera创建时传locked会报合同错误，camera更新locked返回`entity-not-lockable`且不应用混合字段。上锁扫描全worldSpace.setups：任何该entity的owner track只要keys非空即返回`entity-animated`及“有动画的对象不能锁定。”，无需channels非空；空track不算动画。已locked对象即使有动画仍允许解锁。返回control的`canToggleLock`供caller决定是否提供callback，`animated && !locked`体现为`lockDisabled`。

既有update合同仍在locked时拒绝transform/pose/path/lookTarget/heldEntityId动作，要求先解锁，混合“解锁+移动”不绕过；本批未扩大该路径为temporal-aware编辑。新增restore-placement明确是**setup base pose**动作，允许locked actor/prop恢复identity，符合原Restore菜单资格。它不接受selected key，不创建key/channel，不声称实现原lb的非base temporal编辑；未来runtime必须独立施加readonly、playing/scrub与selected nonbase key的lock gate。重命名、颜色、visible和显式删除不以locked作为权限授权，宿主须另行处理权限。重命名实例不会隐式重写共享角色，角色定义在最后实例删除后仍独立保留。

Restore的目标不是“创建时pose”或基准snapshot：actor/prop position/rotation归零、scale归一；camera transform位置(0,1.6,0)、rotation零、scale一，camera.position同步、camera.rotation `{x:0,y:0,z:0,order:'XYZ'}`，完整保留FOV/焦段/画幅/光圈/景深模式/focus/lookAt等光学字段。若camera state缺失，调用方可传真实当前导航相机`fallbackCamera`；没有该实际输入时返回`camera-state-unavailable`，不虚构默认光学参数。当前正常create camera已有state，fallback能力未声明已接入runtime。camera没有Drop菜单，1.6m恢复不是假造camera落地。

本批来源：[实体菜单研究](../../../docs/research/STUDIO-V3-ENTITY-MENU-20261008.md)的Am/ko/Ul/R2、wy/m1/Qc、la/kW静态安装包合同；仅实现其中明确的纯领域动作，没有执行官方bundle或新增外部调用。

验证：

```sh
node --test tests/studio-v3-entity-actions.test.cjs
node --test tests/studio-v3-entity-menu-actions.test.cjs
node --check src/features/studio-v3/entity-actions.mjs
```

2026-10-08先运行16项新专项全部通过；随后补camera optics/角色与实例ID回归，定向运行新回归及受改动影响的camera creation/pose共4项通过（当前18项）。覆盖实际本地文件/目录asset、角色实例分离、基准保护、锁定、局部与全局移除、相机view/output/reference/track级联、克隆角色保持、partial camera pose同步、非法数据、无修改和history lane撤销/重做。未重复已过全库，未进行浏览器/视觉/持久化重开验收。

2026-10-08菜单合同补齐：只运行新增7项专项和受变更影响的旧baseline删除1项，均通过；未运行旧全套。验证identity与camera1.6m/optics不变、fallback缺失明确失败、restore无变化、locked base restore、基准readOnly及删除owner global路由、camera无lock、全world其他setup有keys且无channels也禁锁、空track可锁、animated已locked可解锁。当前专项仍是纯领域证据，未声称entry/runtime或浏览器菜单已验收；本批只修改此模块、相关专项测试与本文，不修改入口/runtime，不提交。
