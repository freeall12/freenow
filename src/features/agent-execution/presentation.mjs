import {isImageEditorTool,imageEditorPresentation} from './image-editor-presentation.mjs';
import {depthActions,depthToolDetails,depthTaskState,isDepthTool} from './depth-card.mjs';
import {isVideoTrimTool,videoTrimPresentation} from './video-trim-presentation.mjs';
import {isSubjectsTool,subjectsPresentation} from './subjects-presentation.mjs';
const imageProcessingActions={'image.upscale':'图片超分','image.relight':'图片打光','image.multiAngle':'多角度调整','image.remove-background':'图片抠图'};
const actions={...depthActions,generation_video_models:'读取视频模型能力',
 web_search:'检索公开网络',agent_delegate:'编排子任务',ask_question:'询问创作需求',
 show_app:'展示应用',show_form:'收集创作表单',show_html:'展示互动作品',show_widget:'展示互动组件',prepare_widget:'准备互动组件',
 artifacts_list:'读取文件列表',artifacts_read:'读取文件',artifacts_write:'保存文件',
 conversation_read:'读取对话记录',canvas_read_node:'读取节点详情',canvas_disconnect:'断开节点连线',canvas_redo:'重做画布修改',canvas_resize:'调整节点尺寸',
 canvas_read:'读取画布上下文',canvas_inspect_media:'查看画布画面',canvas_add:'添加画布节点',canvas_update:'更新画布节点',canvas_connect:'连接画布节点',canvas_delete:'删除画布节点',canvas_group:'创建分组',canvas_stack:'堆叠素材',canvas_unstack:'取消堆叠',canvas_pile_release:'移出堆叠',canvas_ungroup:'取消分组',canvas_layout:'排列画布节点',canvas_generation_config:'设置生成参数',canvas_focus:'定位画布节点',canvas_undo:'撤销画布修改',
 workflow_run:'启动分组工作流',workflow_status:'检查工作流进度',workflow_stop:'停止工作流',templates_list:'读取模板列表',template_save:'保存模板',template_use:'使用模板',
 scene_select:'选择片场对象',scene_motion_read:'读取运镜关键帧',scene_motion_select:'选择运镜关键帧',scene_motion_edit:'编辑运镜',scene_export_video:'导出运镜视频',generation_retry_application:'恢复生成结果',
 scene_create:'创建片场',scene_open:'打开片场',scene_read:'读取片场',scene_library:'读取片场素材',scene_sample:'添加片场素材',scene_add:'添加片场对象',scene_update:'更新片场对象',scene_delete:'删除片场对象',scene_camera:'设置相机',scene_capture:'拍摄画面',scene_keyframe:'设置关键帧',scene_playback:'控制片场预览',scene_setup:'切换片场状态',scene_environment:'设置片场环境',scene_export:'导出片场',scene_panorama:'处理全景图',scene_undo:'撤销片场修改',
 world_read:'读取3D世界生成设置',world_generate:'生成3D资产或世界',skills_list:'读取技能列表',skills_read:'读取技能',skills_save:'保存技能',skills_rename:'重命名个人技能',skills_uninstall:'卸载个人技能',scene_import:'导入画布3D资源',scene_redo:'重做片场修改',generation_submit:'提交生成任务',generation_status:'检查生成进度',generation_wait:'等待生成结果',generation_cancel:'取消生成任务'
};
export function toolPresentation(trace){
 if(isImageEditorTool(trace))return imageEditorPresentation(trace);
 if(isSubjectsTool(trace))return subjectsPresentation(trace);
 if(isVideoTrimTool(trace))return videoTrimPresentation(trace);
 const args=trace.args||{},action=(trace.name==='generation_submit'?imageProcessingActions[args.kind]:null)||actions[trace.name]||trace.name||'工具操作';
 const detail=trace.name==='skills_rename'?`${args.name} → ${args.new_name}`:trace.name==='skills_uninstall'?`${args.name}（移除个人技能包，无法从归档恢复）`:isDepthTool(trace)?depthToolDetails(trace).join(' · '):args.query||args.title||args.artifact_path||args.name||args.nodeId||args.id||args.groupId||'';
 let text=action+(detail?' · '+detail:'');
 if(trace.name==='skills_read')text='读取 '+(args.name||'技能');
 if(trace.name==='artifacts_read'||trace.name==='artifacts_write')text=(trace.name==='artifacts_read'?'读取 ':'编辑 ')+(args.artifact_path||'文件');
 const prefix={pending:'等待确认：',running:'正在',done:'已',error:'失败：',denied:'已拒绝：',cancelled:'已停止：',interrupted:'结果未恢复：'};
 const icon=trace.name==='skills_read'?'skill':/^(conversation_read|canvas_read_node|canvas_read|canvas_inspect_media|scene_motion_read|scene_read|scene_library|world_read|artifacts_read|artifacts_list|skills_list|templates_list)$/.test(trace.name)?'read':['artifacts_write','skills_save'].includes(trace.name)?'edit':'command';
 // A returned job ID means submission, never completed media generation.
 let label=(prefix[(trace.result?.error||trace.error)&&['show_html','show_widget','show_app','prepare_widget'].includes(trace.name)?'error':trace.status]||'')+text;
 if(trace.name==='ask_question')label=trace.status==='waiting'?'等待你的回答':trace.status==='done'?'已收到回答':(prefix[trace.status]||'')+'询问创作需求';
 if(trace.name==='show_form')label=trace.status==='waiting'?'等待填写表单':trace.status==='done'?(trace.result?.skipped?'用户已跳过表单':'已收到表单'):(prefix[trace.status]||'')+'收集创作表单';
 if(trace.name==='generation_wait'&&trace.status==='done')label='已检查生成任务 · '+(trace.result?.status||'等待结束');
 if(isDepthTool(trace))label=action+' · '+depthTaskState(trace).label;
 return {label,action,detail,icon};
}
