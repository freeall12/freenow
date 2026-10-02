(function(root){
 'use strict';
 const ratios=[['16:9',16/9],['9:16',9/16],['4:3',4/3],['3:4',3/4],['1:1',1],['3:2',1.5],['2:3',2/3],['4:5',.8],['9:19.5',9/19.5],['9:21',9/21],['1.33:1',1.33],['1.37:1',1.37],['1.43:1',1.43],['1.66:1',1.66],['1.85:1',1.85],['2.00:1',2],['2.20:1',2.2],['2.35:1',2.35],['2.39:1',2.39]];
 function frame(width,height,aspect){
  let w=Math.sqrt(.5*width*height*aspect),h=w/aspect;
  if(h>height*.95){h=height*.95;w=h*aspect;}
  if(w>width*.95){w=width*.95;h=w/aspect;}
  w=Math.round(w);h=Math.round(h);
  return {x:Math.round((width-w)/2),y:Math.round((height-h)/2),width:w,height:h};
 }
 function sensorHeight(aspect){const w=aspect>=1?36:24,h=aspect>=1?24:36;return Math.min(h,w/aspect);}
 function fov(focal,aspect){return 2*Math.atan(sensorHeight(aspect)/(2*focal))*180/Math.PI;}
 function expandedFov(fov,heightFraction){return 2*Math.atan(Math.tan(fov*Math.PI/360)/heightFraction)*180/Math.PI;}
 root.StudioCamera={ratios,frame,fov,expandedFov};
 if(typeof module!=='undefined')module.exports=root.StudioCamera;
})(typeof window!=='undefined'?window:globalThis);
