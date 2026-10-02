'use strict';

// Only these local classifications may cross the public generation boundary.
// Messages never come from decoder stderr, paths, or provider responses.
const messages=Object.freeze({
 media_tool_unavailable:'本机 FFmpeg/FFprobe 不可用，请检查工具安装和路径；尚未提交视觉模型',
 invalid_video_input:'视频内容、格式或元数据无效，请重新选择可播放的视频；尚未提交视觉模型',
 invalid_video_clip:'视频裁切范围无效，请选择原片内的完整区间；尚未提交视觉模型',
 video_analysis_busy:'本机正在处理其他视频，请稍后重试；尚未提交视觉模型',
 video_analysis_budget:'视频解析超过本机时长、镜头数或媒体大小预算，请先裁短视频；尚未提交视觉模型',
 video_analysis_timeout:'本机视频处理超时，请裁短视频后重试；尚未提交视觉模型',
 video_analysis_failed:'本机视频解码或分镜处理失败，请检查视频是否可播放；尚未提交视觉模型'
});
const localVideoErrorMessage=code=>typeof code==='string'&&Object.hasOwn(messages,code)?messages[code]:null;
function localVideoFailure(error,{timedOut=false}={}){
 const code=timedOut?'video_analysis_timeout':localVideoErrorMessage(error?.code)?error.code:'video_analysis_failed';
 return Object.assign(Error(messages[code]),{code,providerDispatched:false});
}
module.exports={localVideoErrorMessage,localVideoFailure};
